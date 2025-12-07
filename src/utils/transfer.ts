import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  address,
  createNoopSigner,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstructionAsync,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { TOKEN_ADDRESS, TokenTicker } from '../types';
import { toBaseUnits } from './jupiter_swap';

/**
 * Convert @solana/kit instruction to @solana/web3.js TransactionInstruction
 */
function kitInstructionToWeb3(kitInstruction: any) {
  return new TransactionInstruction({
    programId: new PublicKey(kitInstruction.programAddress),
    keys: (kitInstruction.accounts || []).map((account: any) => ({
      pubkey: new PublicKey(account.address),
      // AccountRole: READONLY = 0, WRITABLE = 1, READONLY_SIGNER = 2, WRITABLE_SIGNER = 3
      isSigner: account.role >= 2,
      isWritable: account.role === 1 || account.role === 3,
    })),
    data: kitInstruction.data ? Buffer.from(kitInstruction.data) : Buffer.alloc(0),
  });
}

/**
 * Build SPL token transfer transaction (unsigned) using Legacy Message
 *
 * Uses Legacy Message instead of V0 to ensure compatibility.
 * Always fetches fresh blockhash for sequential execution.
 *
 * Uses @solana/kit for ATA derivation and instruction building,
 * then converts to @solana/web3.js Legacy Message.
 */
export async function buildTokenTransferTransaction(
  connection: Connection,
  senderPublicKey: PublicKey,
  token: TokenTicker,
  recipientAddress: string,
  amount: number
): Promise<VersionedTransaction> {
  const mintAddressStr = TOKEN_ADDRESS[token];
  if (!mintAddressStr) {
    throw new Error(`Unknown token: ${token}`);
  }

  // Convert to @solana/kit Address types
  // Don't use "as Address" cast - it breaks TypeScript inference for createNoopSigner
  const mintAddress = address(mintAddressStr);
  const senderAddressStr = senderPublicKey.toBase58();
  const senderAddress = address(senderAddressStr);
  const recipientAddr = address(recipientAddress);

  // Create a noop signer for the payer (actual signing happens later via wallet adapter)
  // createNoopSigner needs the exact Address type from address() function
  const payerSigner = createNoopSigner(senderAddress);

  // Derive ATAs using @solana/kit's findAssociatedTokenPda
  const [sourceATA] = await findAssociatedTokenPda({
    mint: mintAddress,
    owner: senderAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const [destinationATA] = await findAssociatedTokenPda({
    mint: mintAddress,
    owner: recipientAddr,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Build instructions array (web3.js format)
  const instructions = [];

  // Add compute budget instructions
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })
  );
  instructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
  );

  // Check if destination ATA exists
  const destinationAccountInfo = await connection.getAccountInfo(
    new PublicKey(destinationATA)
  );

  if (!destinationAccountInfo) {
    // Create ATA for recipient using @solana-program/token
    // Use createNoopSigner for payer since actual signing happens later
    const createATAIx = await getCreateAssociatedTokenInstructionAsync({
      payer: payerSigner,
      mint: mintAddress,
      owner: recipientAddr,
    });
    instructions.push(kitInstructionToWeb3(createATAIx));
  }

  // Create transfer instruction using @solana-program/token
  const transferAmount = toBaseUnits(amount, token);
  const transferIx = getTransferInstruction({
    source: sourceATA,
    destination: destinationATA,
    authority: payerSigner,
    amount: BigInt(transferAmount),
  });
  instructions.push(kitInstructionToWeb3(transferIx));

  // Always fetch fresh blockhash for sequential execution
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // Build transaction using Legacy Message (Jito compatible - no ALT)
  const legacyMessage = new TransactionMessage({
    payerKey: senderPublicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToLegacyMessage();

  const transaction = new VersionedTransaction(legacyMessage);

  // Verify base64 serialization
  verifyTransactionSerializable(transaction);

  return transaction;
}

/**
 * Verify transaction can be serialized to base64 (for Jito bundle)
 */
function verifyTransactionSerializable(transaction: VersionedTransaction): void {
  try {
    const serialized = transaction.serialize();
    const base64 = Buffer.from(serialized).toString('base64');
    
    // Verify round-trip
    const decoded = Buffer.from(base64, 'base64');
    VersionedTransaction.deserialize(decoded);

    // Check transaction size limit
    if (serialized.length > 1232) {
      console.warn(`Transaction size (${serialized.length} bytes) exceeds limit.`);
    }
  } catch (error) {
    throw new Error(`Transaction serialization failed: ${error}`);
  }
}

/**
 * Get transaction as base64 string
 */
export function getTransactionBase64(transaction: VersionedTransaction): string {
  return Buffer.from(transaction.serialize()).toString('base64');
}