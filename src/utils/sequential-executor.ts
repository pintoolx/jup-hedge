import { Connection, VersionedTransaction } from '@solana/web3.js';

/**
 * Status of individual transaction execution
 */
export type TransactionExecutionStatus =
  | 'pending'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'confirmed'
  | 'failed';

/**
 * Progress tracking for each transaction
 */
export interface TransactionProgress {
  index: number;
  name: string;
  status: TransactionExecutionStatus;
  signature?: string;
  error?: string;
}

/**
 * Result of sequential execution
 */
export interface SequentialExecutionResult {
  success: boolean;
  transactions: TransactionProgress[];
  error?: string;
  failedAtIndex?: number;
}

/**
 * Lazy transaction builder interface
 * The build function is called just before signing to get fresh blockhash
 */
export interface TransactionToBuild {
  name: string;
  build: () => Promise<VersionedTransaction>;
}

/**
 * Execute transactions sequentially with fresh blockhash per transaction.
 * Stops on first failure.
 *
 * @param connection - Solana RPC connection
 * @param signTransaction - Wallet adapter's signTransaction function
 * @param transactionBuilders - Array of lazy transaction builders
 * @param onProgress - Optional callback for progress updates
 * @returns Result containing success status and transaction details
 */
export async function executeTransactionsSequentially(
  connection: Connection,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  transactionBuilders: TransactionToBuild[],
  onProgress?: (progress: TransactionProgress[]) => void
): Promise<SequentialExecutionResult> {
  const results: TransactionProgress[] = transactionBuilders.map((builder, index) => ({
    index,
    name: builder.name,
    status: 'pending' as TransactionExecutionStatus,
  }));

  const updateProgress = (index: number, updates: Partial<TransactionProgress>) => {
    results[index] = { ...results[index], ...updates };
    onProgress?.([...results]);
  };

  for (let i = 0; i < transactionBuilders.length; i++) {
    const builder = transactionBuilders[i];

    try {
      // Step 1: Build transaction (gets fresh blockhash)
      updateProgress(i, { status: 'building' });
      const tx = await builder.build();

      // Step 2: Sign with wallet
      updateProgress(i, { status: 'signing' });
      const signedTx = await signTransaction(tx);

      // Step 3: Submit to network
      updateProgress(i, { status: 'submitting' });
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      // Step 4: Confirm transaction
      updateProgress(i, { status: 'confirming', signature });

      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        const errorMsg = `Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`;
        updateProgress(i, { status: 'failed', error: errorMsg });
        return {
          success: false,
          transactions: results,
          error: errorMsg,
          failedAtIndex: i,
        };
      }

      // Success
      updateProgress(i, { status: 'confirmed' });
      console.log(`Transaction ${i + 1}/${transactionBuilders.length} confirmed: ${signature}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      updateProgress(i, { status: 'failed', error: errorMsg });

      return {
        success: false,
        transactions: results,
        error: errorMsg,
        failedAtIndex: i,
      };
    }
  }

  return {
    success: true,
    transactions: results,
  };
}
