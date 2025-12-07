import {
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  Connection
} from '@solana/web3.js';
import { JITO_ENDPOINTS, JitoBundleResult, BundleStatus } from '../types';
import axios from "axios";

/**
 * Jito JSON-RPC API client for browser
 * All transactions use Legacy Message for Jito bundle compatibility
 * (Jito does not support Address Lookup Tables)
 *
 * NOTE: These functions are used by useJitoBundle hook for atomic bundle execution.
 * For sequential (non-atomic) execution, see sequential-executor.ts
 */

const DEFAULT_TIP_LAMPORTS = 10_000; // 0.00001 SOL minimum

// Jito tip accounts (static list to avoid API call)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVmrqYHMDPhLmLB9mP8EAG',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSjbnAHwPLnHzx8E6Wq',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

/**
 * Get a random Jito tip account
 */
export function getRandomTipAccount(): PublicKey {
  const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]);
}

/**
 * Get Jito tip accounts from API (optional, can use static list instead)
 */
export async function getTipAccounts(
  endpoint: string = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
): Promise<string[]> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTipAccounts',
        params: [],
      }),
    });

    const data = await response.json();
    if (data.error) {
      console.warn('getTipAccounts failed, using static list:', data.error.message);
      return JITO_TIP_ACCOUNTS;
    }

    return data.result || JITO_TIP_ACCOUNTS;
  } catch (error) {
    console.warn('getTipAccounts failed, using static list:', error);
    return JITO_TIP_ACCOUNTS;
  }
}

/**
 * Create a tip transaction using Legacy Message
 * 
 * Uses Legacy Message instead of V0 to ensure Jito bundle compatibility
 * (Jito does not support Address Lookup Tables)
 */
export async function createTipTransaction(
  connection: Connection,
  payerPubkey: PublicKey,
  tipLamports: number = DEFAULT_TIP_LAMPORTS,
  recentBlockhash?: string
): Promise<VersionedTransaction> {
  // Select random tip account to reduce contention
  const tipAccount = getRandomTipAccount();

  // Use provided blockhash or fetch new one
  const blockhash = recentBlockhash ?? (await connection.getLatestBlockhash('confirmed')).blockhash;

  // Build tip instruction
  const tipInstruction = SystemProgram.transfer({
    fromPubkey: payerPubkey,
    toPubkey: tipAccount,
    lamports: tipLamports,
  });

  // Create transaction using Legacy Message (Jito compatible - no ALT)
  const legacyMessage = new TransactionMessage({
    payerKey: payerPubkey,
    recentBlockhash: blockhash,
    instructions: [tipInstruction],
  }).compileToLegacyMessage();

  const transaction = new VersionedTransaction(legacyMessage);

  // Verify serialization
  verifyTransactionSerializable(transaction);

  return transaction;
}

/**
 * Verify transaction can be serialized to base64
 */
function verifyTransactionSerializable(transaction: VersionedTransaction): void {
  try {
    const serialized = transaction.serialize();
    Buffer.from(serialized).toString('base64');
  } catch (error) {
    throw new Error(`Tip transaction serialization failed: ${error}`);
  }
}

/**
 * Submit bundle to Jito
 * All transactions are serialized to base64 for submission
 */
export async function sendBundle(
  transactions: VersionedTransaction[],
  endpoint: string = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
): Promise<string> {
  // Serialize transactions to base64
  const encodedTransactions = transactions.map((transaction) => {
    const serialized = transaction.serialize();
    return Buffer.from(serialized).toString('base64');
  });

  console.log('Sending bundle with transactions:', encodedTransactions.length);
  console.log('Transaction sizes:', transactions.map(tx => tx.serialize().length));

  const response = await axios.post(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [
      encodedTransactions,
      {
        encoding: 'base64',
      }
    ],
  });

  const data = response.data;
  if (data.error) {
    throw new Error(`sendBundle failed: ${data.error.message}`);
  }

  return data.result; // Returns bundle ID
}

/**
 * Get bundle status
 */
export async function getBundleStatuses(
  bundleIds: string[],
  endpoint: string = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
): Promise<(BundleStatus | null)[]> {
  const response = await axios.post(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBundleStatuses',
    params: [bundleIds],
  });

  const data = response.data;
  if (data.error) {
    throw new Error(`getBundleStatuses failed: ${data.error.message}`);
  }

  return data.result?.value || [];
}

/**
 * Get bundle inflight status
 */
export async function getBundleInflightStatuses(
  bundleIds: string[],
  endpoint: string = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
): Promise<(BundleStatus | null)[]> {
  const response = await axios.post(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getInflightBundleStatuses',
    params: [bundleIds],
  });

  const data = response.data;
  if (data.error) {
    throw new Error(`getInflightBundleStatuses failed: ${data.error.message}`);
  }

  return data.result?.value || [];
}

/**
 * Wait for bundle confirmation with polling
 */
export async function waitForBundleConfirmation(
  bundleId: string,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 2000
): Promise<JitoBundleResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const statuses = await getBundleStatuses([bundleId]);
      console.log('Bundle statuses:', statuses);
      
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      const inflightStatuses = await getBundleInflightStatuses([bundleId]);
      console.log('Bundle inflight statuses:', inflightStatuses);
      
      const status = statuses[0];

      if (status) {
        if (status.confirmation_status === 'confirmed' || status.confirmation_status === 'finalized') {
          return {
            bundleId,
            success: true,
          };
        }
        if (status.err) {
          return {
            bundleId,
            success: false,
            error: JSON.stringify(status.err),
          };
        }
      }
    } catch (error) {
      console.warn('Error polling bundle status:', error);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    bundleId,
    success: false,
    error: 'Bundle confirmation timeout',
  };
}

/**
 * Simulate bundle using Jito's simulateBundle API
 * This simulates all transactions atomically, preserving state between transactions
 */
export async function simulateBundleWithJito(
  transactions: VersionedTransaction[],
  endpoint: string = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Serialize transactions to base64
    const encodedTransactions = transactions.map((tx) => {
      return Buffer.from(tx.serialize()).toString('base64');
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateBundle',
        params: [
          {
            encodedTransactions,
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('Jito simulateBundle error:', data.error);
      return {
        success: false,
        error: `Jito simulation failed: ${data.error.message || JSON.stringify(data.error)}`,
      };
    }

    // Check simulation results
    const result = data.result;
    if (result?.value?.err) {
      console.error('Jito bundle simulation failed:', result.value.err);
      return {
        success: false,
        error: `Bundle simulation failed: ${JSON.stringify(result.value.err)}`,
      };
    }

    console.log('Jito bundle simulation passed');
    return { success: true };
  } catch (error) {
    console.warn('Jito simulateBundle not available, skipping simulation:', error);
    // If Jito simulation endpoint is not available, continue without simulation
    return { success: true };
  }
}

/**
 * Simulate individual transactions (for standalone transactions only)
 * NOTE: This doesn't work for dependent bundle transactions!
 * Use simulateBundleWithJito for bundles instead.
 */
export async function simulateIndividualTransactions(
  connection: Connection,
  transactions: VersionedTransaction[]
): Promise<{ success: boolean; error?: string; logs?: string[][] }> {
  const allLogs: string[][] = [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    try {
      const result = await connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: 'confirmed',
      });

      if (result.value.logs) {
        allLogs.push(result.value.logs);
      }

      if (result.value.err) {
        console.error(`Transaction ${i} simulation failed:`, result.value.err);
        console.error(`Transaction ${i} logs:`, result.value.logs);
        return {
          success: false,
          error: `Transaction ${i} simulation failed: ${JSON.stringify(result.value.err)}`,
          logs: allLogs,
        };
      }
      console.log(`Transaction ${i} simulation passed`);
    } catch (error) {
      console.error(`Transaction ${i} simulation error:`, error);
      return {
        success: false,
        error: `Transaction ${i} simulation error: ${error}`,
        logs: allLogs,
      };
    }
  }
  return { success: true, logs: allLogs };
}

/**
 * Submit bundle and wait for confirmation
 */
export async function submitAndConfirmBundle(
  transactions: VersionedTransaction[],
  connection: Connection,
  timeoutMs: number = 60000
): Promise<JitoBundleResult> {
  try {
    // Log detailed transaction info for debugging
    console.log('=== Bundle Transaction Details ===');
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      const serialized = tx.serialize();
      console.log(`Transaction ${i}:`, {
        version: tx.message.version,
        blockhash: tx.message.recentBlockhash,
        numSignatures: tx.signatures.length,
        hasSigned: tx.signatures.some(s => s.some(b => b !== 0)),
        size: serialized.length,
      });
    }
    console.log('=================================');

    // Validate all transactions before submission
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      const serialized = tx.serialize();

      if (serialized.length > 1232) {
        return {
          bundleId: '',
          success: false,
          error: `Transaction ${i} exceeds size limit (${serialized.length} > 1232 bytes)`,
        };
      }

      // Check if transaction uses ALT (V0 with lookup tables)
      if (tx.message.version === 0) {
        const v0Message = tx.message as any;
        if (v0Message.addressTableLookups && v0Message.addressTableLookups.length > 0) {
          return {
            bundleId: '',
            success: false,
            error: `Transaction ${i} uses Address Lookup Tables which Jito does not support`,
          };
        }
      }
    }

    // NOTE: Bundle simulation is skipped because:
    // 1. Jito's simulateBundle is only available on Jito-Solana RPC, not the public bundle API
    // 2. Individual transaction simulation fails for dependent transactions
    //    (e.g., transfer tx needs tokens from swap tx which hasn't executed yet)
    // The bundle will be validated by Jito when submitted.
    console.log('Skipping simulation for atomic bundle (transactions are interdependent)');

    console.log(`Submitting bundle with ${transactions.length} transactions...`);
    const bundleId = await sendBundle(transactions);
    console.log(`Bundle submitted: ${bundleId}`);

    return await waitForBundleConfirmation(bundleId, timeoutMs);
  } catch (error) {
    return {
      bundleId: '',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Utility: Convert transaction to base64 string
 */
export function transactionToBase64(transaction: VersionedTransaction): string {
  return Buffer.from(transaction.serialize()).toString('base64');
}

/**
 * Utility: Check if transaction is Jito compatible
 */
export function isJitoCompatible(transaction: VersionedTransaction): {
  compatible: boolean;
  reason?: string;
} {
  try {
    const serialized = transaction.serialize();
    
    // Check size
    if (serialized.length > 1232) {
      return {
        compatible: false,
        reason: `Transaction size (${serialized.length} bytes) exceeds 1232 byte limit`,
      };
    }

    // Check for ALT usage
    if (transaction.message.version === 0) {
      const v0Message = transaction.message as any;
      if (v0Message.addressTableLookups && v0Message.addressTableLookups.length > 0) {
        return {
          compatible: false,
          reason: 'Transaction uses Address Lookup Tables',
        };
      }
    }

    // Verify base64 round-trip
    const base64 = Buffer.from(serialized).toString('base64');
    const decoded = Buffer.from(base64, 'base64');
    VersionedTransaction.deserialize(decoded);

    return { compatible: true };
  } catch (error) {
    return {
      compatible: false,
      reason: `Serialization error: ${error}`,
    };
  }
}