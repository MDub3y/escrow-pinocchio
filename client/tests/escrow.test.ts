import { expect, test, describe, beforeAll } from "bun:test";
import { LiteSVM } from "litesvm";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createInitializeMintInstruction,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    MINT_SIZE,
    getAccount
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("xcDvPMRyBeQdqisgJ2QRLnGqHFbpqxV5wZXMZZfmExi");

describe("Pinocchio Escrow Integration Tests", () => {
    let svm: LiteSVM;
    let maker: Keypair;
    let taker: Keypair;
    let tokenMintA: Keypair;
    let tokenMintB: Keypair;
    let makerTokenAccountA: PublicKey;
    let takerTokenAccountB: PublicKey;

    const offerId = 42n;
    const refundOfferId = 99n;
    const tokenAOfferedAmount = 1_000_000n;
    const tokenBWantedAmount = 2_000_000n;

    const getTokenBalance = (account: PublicKey): bigint => {
        const accountInfo = svm.getAccount(account);
        if (!accountInfo) return 0n;
        return Buffer.from(accountInfo.data).readBigUInt64LE(64);
    };

    beforeAll(() => {
        svm = new LiteSVM();

        svm.addProgramFromFile(PROGRAM_ID, "../target/deploy/escrow_pinocchio.so");

        maker = Keypair.generate();
        taker = Keypair.generate();
        tokenMintA = Keypair.generate();
        tokenMintB = Keypair.generate();

        svm.airdrop(maker.publicKey, 10_000_000_000n);
        svm.airdrop(taker.publicKey, 10_000_000_000n);

        const rentExemptMint = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));

        const setupTx = new Transaction();
        setupTx.recentBlockhash = svm.latestBlockhash();

        setupTx.add(
            SystemProgram.createAccount({
                fromPubkey: maker.publicKey,
                newAccountPubkey: tokenMintA.publicKey,
                lamports: Number(rentExemptMint),
                space: MINT_SIZE,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMintInstruction(tokenMintA.publicKey, 6, maker.publicKey, null)
        );

        setupTx.add(
            SystemProgram.createAccount({
                fromPubkey: maker.publicKey,
                newAccountPubkey: tokenMintB.publicKey,
                lamports: Number(rentExemptMint),
                space: MINT_SIZE,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMintInstruction(tokenMintB.publicKey, 6, maker.publicKey, null)
        );

        makerTokenAccountA = getAssociatedTokenAddressSync(tokenMintA.publicKey, maker.publicKey);
        setupTx.add(
            createAssociatedTokenAccountInstruction(
                maker.publicKey,
                makerTokenAccountA,
                maker.publicKey,
                tokenMintA.publicKey
            ),
            createMintToInstruction(tokenMintA.publicKey, makerTokenAccountA, maker.publicKey, 5_000_000n)
        );

        takerTokenAccountB = getAssociatedTokenAddressSync(tokenMintB.publicKey, taker.publicKey);
        setupTx.add(
            createAssociatedTokenAccountInstruction(
                maker.publicKey,
                takerTokenAccountB,
                taker.publicKey,
                tokenMintB.publicKey
            ),
            createMintToInstruction(tokenMintB.publicKey, takerTokenAccountB, maker.publicKey, 5_000_000n)
        );

        setupTx.sign(maker, taker, tokenMintA, tokenMintB);
        svm.sendTransaction(setupTx);
    });

    test("Successfully executes Make Offer", () => {
        const idBuffer = Buffer.alloc(8);
        idBuffer.writeBigUInt64LE(offerId);

        const [offerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("offer"), idBuffer],
            PROGRAM_ID
        );

        const vault = getAssociatedTokenAddressSync(tokenMintA.publicKey, offerPda, true);

        const instructionData = Buffer.alloc(1 + 8 + 8 + 8);
        instructionData.writeUInt8(0, 0);
        instructionData.writeBigUInt64LE(offerId, 1);
        instructionData.writeBigUInt64LE(tokenAOfferedAmount, 9);
        instructionData.writeBigUInt64LE(tokenBWantedAmount, 17);

        const makeOfferIx = new TransactionInstruction({
            programId: PROGRAM_ID,
            data: instructionData,
            keys: [
                { pubkey: maker.publicKey, isSigner: true, isWritable: true },
                { pubkey: tokenMintA.publicKey, isSigner: false, isWritable: false },
                { pubkey: tokenMintB.publicKey, isSigner: false, isWritable: false },
                { pubkey: makerTokenAccountA, isSigner: false, isWritable: true },
                { pubkey: offerPda, isSigner: false, isWritable: true },
                { pubkey: vault, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
        });

        const tx = new Transaction().add(makeOfferIx);
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(maker);

        const txMetadata = svm.sendTransaction(tx);

        if ("err" in txMetadata) {
            throw new Error(`Transaction failed: ${txMetadata.toString()}`);
        }

        console.log(`CU Consumed: ${txMetadata.computeUnitsConsumed()}`);

        const offerAccount = svm.getAccount(offerPda);
        expect(offerAccount).toBeDefined();
        expect(offerAccount!.owner.toBase58()).toBe(PROGRAM_ID.toBase58());

        const dataBuffer = Buffer.from(offerAccount!.data);
        const savedId = dataBuffer.readBigUInt64LE(0);
        const savedMaker = new PublicKey(dataBuffer.subarray(8, 40));
        const savedMintA = new PublicKey(dataBuffer.subarray(40, 72));
        const savedMintB = new PublicKey(dataBuffer.subarray(72, 104));
        const savedWantedAmount = dataBuffer.readBigUInt64LE(104);

        expect(savedId).toBe(offerId);
        expect(savedMaker.toBase58()).toBe(maker.publicKey.toBase58());
        expect(savedMintA.toBase58()).toBe(tokenMintA.publicKey.toBase58());
        expect(savedMintB.toBase58()).toBe(tokenMintB.publicKey.toBase58());
        expect(savedWantedAmount).toBe(tokenBWantedAmount);
    });

    test("Successfully executes Take Offer", () => {
        const idBuffer = Buffer.alloc(8);
        idBuffer.writeBigUInt64LE(offerId);

        const [offerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("offer"), idBuffer],
            PROGRAM_ID
        );

        const vault = getAssociatedTokenAddressSync(tokenMintA.publicKey, offerPda, true);

        // Derive target fulfillment accounts that the program creates via Idempotent CPI
        const takerTokenAccountA = getAssociatedTokenAddressSync(tokenMintA.publicKey, taker.publicKey);
        const makerTokenAccountB = getAssociatedTokenAddressSync(tokenMintB.publicKey, maker.publicKey);

        const instructionData = Buffer.alloc(1);
        instructionData.writeUInt8(1, 0); // Discriminator 1: Take Offer

        const takeOfferIx = new TransactionInstruction({
            programId: PROGRAM_ID,
            data: instructionData,
            keys: [
                { pubkey: taker.publicKey, isSigner: true, isWritable: true },
                { pubkey: maker.publicKey, isSigner: false, isWritable: true },
                { pubkey: tokenMintA.publicKey, isSigner: false, isWritable: false },
                { pubkey: tokenMintB.publicKey, isSigner: false, isWritable: false },
                { pubkey: takerTokenAccountA, isSigner: false, isWritable: true },
                { pubkey: takerTokenAccountB, isSigner: false, isWritable: true },
                { pubkey: makerTokenAccountB, isSigner: false, isWritable: true },
                { pubkey: offerPda, isSigner: false, isWritable: true },
                { pubkey: vault, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
        });

        const tx = new Transaction().add(takeOfferIx);
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(taker);

        const txMetadata = svm.sendTransaction(tx);
        if ("err" in txMetadata) {
            throw new Error(`Take Offer Failed: ${txMetadata.toString()}`);
        }

        console.log(`CU Consumed (Take Offer): ${txMetadata.computeUnitsConsumed()}`);

        expect(getTokenBalance(takerTokenAccountA)).toBe(tokenAOfferedAmount);
        expect(getTokenBalance(makerTokenAccountB)).toBe(tokenBWantedAmount);

        expect(svm.getAccount(offerPda)).toBeNull();
        expect(svm.getAccount(vault)).toBeNull();
    });

    test("Successfully executes Refund Offer", () => {
        const idBuffer = Buffer.alloc(8);
        idBuffer.writeBigUInt64LE(refundOfferId);

        const [offerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("offer"), idBuffer],
            PROGRAM_ID
        );
        const vault = getAssociatedTokenAddressSync(tokenMintA.publicKey, offerPda, true);

        const makeData = Buffer.alloc(1 + 8 + 8 + 8);
        makeData.writeUInt8(0, 0);
        makeData.writeBigUInt64LE(refundOfferId, 1);
        makeData.writeBigUInt64LE(tokenAOfferedAmount, 9);
        makeData.writeBigUInt64LE(tokenBWantedAmount, 17);

        const makeOfferIx = new TransactionInstruction({
            programId: PROGRAM_ID,
            data: makeData,
            keys: [
                { pubkey: maker.publicKey, isSigner: true, isWritable: true },
                { pubkey: tokenMintA.publicKey, isSigner: false, isWritable: false },
                { pubkey: tokenMintB.publicKey, isSigner: false, isWritable: false },
                { pubkey: makerTokenAccountA, isSigner: false, isWritable: true },
                { pubkey: offerPda, isSigner: false, isWritable: true },
                { pubkey: vault, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
        });

        const makeTx = new Transaction().add(makeOfferIx);
        makeTx.recentBlockhash = svm.latestBlockhash();
        makeTx.sign(maker);
        svm.sendTransaction(makeTx);

        const balanceBeforeRefund = getTokenBalance(makerTokenAccountA);

        const refundData = Buffer.alloc(1);
        refundData.writeUInt8(2, 0);

        const refundOfferIx = new TransactionInstruction({
            programId: PROGRAM_ID,
            data: refundData,
            keys: [
                { pubkey: maker.publicKey, isSigner: true, isWritable: true },
                { pubkey: tokenMintA.publicKey, isSigner: false, isWritable: false },
                { pubkey: makerTokenAccountA, isSigner: false, isWritable: true },
                { pubkey: offerPda, isSigner: false, isWritable: true },
                { pubkey: vault, isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
        });

        const refundTx = new Transaction().add(refundOfferIx);
        refundTx.recentBlockhash = svm.latestBlockhash();
        refundTx.sign(maker);

        const txMetadata = svm.sendTransaction(refundTx);
        if ("err" in txMetadata) {
            throw new Error(`Refund Offer Failed: ${txMetadata.toString()}`);
        }

        console.log(`CU Consumed (Refund Offer): ${txMetadata.computeUnitsConsumed()}`);

        expect(getTokenBalance(makerTokenAccountA)).toBe(balanceBeforeRefund + tokenAOfferedAmount);

        expect(svm.getAccount(offerPda)).toBeNull();
        expect(svm.getAccount(vault)).toBeNull();
    });
});