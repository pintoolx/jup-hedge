import { VersionedTransaction, PublicKey, SystemProgram, TransactionMessage, Connection } from '@solana/web3.js';
import { JITO_ENDPOINTS, JitoBundleResult, BundleStatus } from '../types';
import axios from "axios";


/**
 * Jito JSON-RPC API client for browser
 */

const DEFAULT_TIP_LAMPORTS = 10_000; // 0.00001 SOL minimum

/**
 * Get a random Jito tip account (no API call needed)
 */
export async function getRandomTipAccount(): Promise<PublicKey> {
  const addresses = await getTipAccounts();
  setTimeout(() => {}, 1000);
  const randomIndex = Math.floor(Math.random() * addresses.length);
  return new PublicKey(addresses[randomIndex]);
}

/**
 * Get Jito tip accounts
 */
export async function getTipAccounts(
  endpoint: string = 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/getTipAccounts'
): Promise<PublicKey[]> {
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
    throw new Error(`getTipAccounts failed: ${data.error.message}`);
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  return data.result;
}

/**
 * Create a tip transaction
 */
export async function createTipTransaction(
  connection: Connection,
  payerPubkey: PublicKey,
  tipLamports: number = DEFAULT_TIP_LAMPORTS
): Promise<VersionedTransaction> {
  // Select random tip account to reduce contention
  const tipAccount = await getRandomTipAccount();

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // Build tip instruction
  const tipInstruction = SystemProgram.transfer({
    fromPubkey: payerPubkey,
    toPubkey: tipAccount,
    lamports: tipLamports,
  });

  // Create transaction message
  const messageV0 = new TransactionMessage({
    payerKey: payerPubkey,
    recentBlockhash: blockhash,
    instructions: [tipInstruction],
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}

/**
 * Submit bundle to Jito
 */
export async function sendBundle(
  transactions: VersionedTransaction[],
): Promise<string> {
  // Serialize transactions to base64
  const encodedTransactions = transactions.map((transaction) =>
    Buffer.from(transaction.serialize()).toString('base64')
  );

  console.log('Sending bundle with transactions:', encodedTransactions);
  console.log('Transaction count:', encodedTransactions.length);

  const response = await axios.post("https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles", {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [encodedTransactions, 
      {
        encoding: 'base64',
      }
    ],
  });

  const data = await response.data;
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
): Promise<(BundleStatus | null)[]> {
  const response = await axios.post("https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses", {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBundleStatuses',
    params: [bundleIds],
  });

  const data = await response.data;
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
): Promise<(BundleStatus | null)[]> {
  const response = await axios.post("https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/getInflightBundleStatuses", {
    jsonrpc: '2.0',
    id: 1,
    method: 'getInflightBundleStatuses',
    params: [bundleIds],
  });

  const data = await response.data;
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
 * Submit bundle and wait for confirmation
 */
export async function submitAndConfirmBundle(
  transactions: VersionedTransaction[],
  timeoutMs: number = 600000
): Promise<JitoBundleResult> {
  try {
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
