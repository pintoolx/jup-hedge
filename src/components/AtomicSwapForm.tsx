import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { AtomicSwapButton } from './AtomicSwapButton';
import { AtomicOperationConfig } from '../types';

interface AtomicSwapFormProps {
  className?: string;
}

export const AtomicSwapForm: React.FC<AtomicSwapFormProps> = ({ className }) => {
  const { connected, publicKey } = useWallet();

  const [config, setConfig] = useState<AtomicOperationConfig>({
    solAmount: 0.1,
    shortAmount: 10,
    transferAmount: 5,
    targetAddress: '6YDGTnmBDe34SYeziSbsVP6ss5ogWREHXec87CJu7Hos',
    depositAmount: 10, // USDC deposit amount (0 = no deposit)
    jitoTipLamports: 10000, // 0.00001 SOL
  });

  const handleInputChange = (field: keyof AtomicOperationConfig, value: string) => {
    const numericFields = ['solAmount', 'shortAmount', 'transferAmount', 'depositAmount', 'slippageBps', 'jitoTipLamports'];
    
    if (numericFields.includes(field)) {
      setConfig((prev) => ({
        ...prev,
        [field]: parseFloat(value) || 0,
      }));
    } else {
      setConfig((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
  };

  const handleSuccess = (bundleId: string) => {
    console.log('Bundle succeeded:', bundleId);
  };

  const handleError = (error: string) => {
    console.error('Bundle failed:', error);
  };

  return (
    <div
      className={`atomic-swap-form ${className || ''}`}
      style={{
        maxWidth: '500px',
        margin: '0 auto',
        padding: '24px',
        backgroundColor: '#0f172a',
        borderRadius: '16px',
        color: '#e2e8f0',
      }}
    >
      <h2 style={{ marginBottom: '24px', textAlign: 'center' }}>
        ⚡ Atomic Swap-Short-Transfer
      </h2>

      {/* Wallet Connection */}
      <div style={{ marginBottom: '24px', textAlign: 'center' }}>
        <WalletMultiButton />
        {connected && publicKey && (
          <div style={{ marginTop: '8px', fontSize: '14px', color: '#94a3b8' }}>
            Connected: {publicKey.toBase58().slice(0, 8)}...
          </div>
        )}
      </div>

      {/* Configuration Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* SOL Amount - Now auto-calculated for minimum 250 JUP */}
        <div
          style={{
            padding: '12px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#94a3b8',
          }}
        >
          <strong style={{ color: '#e2e8f0' }}>SOL to Swap:</strong> Auto-calculated for minimum 250 JUP (with 5% buffer)
        </div>

        {/* Deposit Amount */}
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            USDC to Deposit (Drift Collateral)
            <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>
              Optional - set 0 to skip
            </span>
          </label>
          <input
            type="number"
            step="1"
            value={config.depositAmount || 0}
            onChange={(e) => handleInputChange('depositAmount', e.target.value)}
            style={inputStyle}
            placeholder="0"
          />
        </div>

        {/* Short Amount */}
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            JUP to Short (on Drift)
          </label>
          <input
            type="number"
            step="1"
            value={config.shortAmount}
            onChange={(e) => handleInputChange('shortAmount', e.target.value)}
            style={inputStyle}
            placeholder="10"
          />
        </div>

        {/* Transfer Amount */}
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            JUP to Transfer
          </label>
          <input
            type="number"
            step="1"
            value={config.transferAmount}
            onChange={(e) => handleInputChange('transferAmount', e.target.value)}
            style={inputStyle}
            placeholder="5"
          />
        </div>

        {/* Target Address */}
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Target Address
          </label>
          <input
            type="text"
            value={config.targetAddress}
            onChange={(e) => handleInputChange('targetAddress', e.target.value)}
            style={inputStyle}
            placeholder="Recipient wallet address"
          />
        </div>

        {/* Advanced Settings */}
        <details style={{ marginTop: '8px' }}>
          <summary style={{ cursor: 'pointer', color: '#94a3b8' }}>
            Advanced Settings
          </summary>
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Slippage */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                Slippage (bps) - 50 = 0.5%
              </label>
              <input
                type="number"
                step="1"
                value={config.slippageBps}
                onChange={(e) => handleInputChange('slippageBps', e.target.value)}
                style={inputStyle}
                placeholder="50"
              />
            </div>

            {/* Jito Tip */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                Jito Tip (lamports) - 50000 = 0.00005 SOL
              </label>
              <input
                type="number"
                step="1000"
                value={config.jitoTipLamports}
                onChange={(e) => handleInputChange('jitoTipLamports', e.target.value)}
                style={inputStyle}
                placeholder="50000"
              />
            </div>
          </div>
        </details>
      </div>

      {/* Summary */}
      <div
        style={{
          marginTop: '24px',
          padding: '16px',
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          fontSize: '14px',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Transaction Summary:</div>
        <div>1. Swap SOL → ~250+ JUP (Jupiter, auto-calculated)</div>
        {config.depositAmount && config.depositAmount > 0 ? (
          <div>2. Deposit {config.depositAmount} USDC + Short {config.shortAmount} JUP-PERP (Drift)</div>
        ) : (
          <div>2. Short {config.shortAmount} JUP-PERP (Drift)</div>
        )}
        <div>3. Transfer {config.transferAmount} JUP → {config.targetAddress?.slice(0, 8) || '...'}</div>
        <div style={{ marginTop: '8px', color: '#94a3b8' }}>
          Jito Tip: {(config.jitoTipLamports || 0) / 1e9} SOL
        </div>
      </div>

      {/* Execute Button */}
      <div style={{ marginTop: '24px', textAlign: 'center' }}>
        <AtomicSwapButton
          config={config}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      </div>

      {/* Info Box */}
      <div
        style={{
          marginTop: '24px',
          padding: '12px',
          backgroundColor: '#172554',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#93c5fd',
        }}
      >
        <strong>ℹ️ How it works:</strong>
        <br />
        All transactions are bundled via Jito and executed atomically.
        If any transaction fails, none will be executed (all-or-nothing).
      </div>

      {/* Warning Box */}
      <div
        style={{
          marginTop: '12px',
          padding: '12px',
          backgroundColor: '#422006',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#fbbf24',
        }}
      >
        <strong>⚠️ Prerequisites:</strong>
        <br />
        • If not depositing USDC in this bundle, you need existing USDC collateral in Drift.
        <br />
        • The USDC deposit (if specified) will be executed in the same transaction as the short.
        <br />
        • Make sure you have enough USDC in your wallet for the deposit amount.
        <br />
        • The JUP transfer will use tokens from the swap output.
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: '8px',
  border: '1px solid #334155',
  backgroundColor: '#1e293b',
  color: '#e2e8f0',
  fontSize: '16px',
  outline: 'none',
};

export default AtomicSwapForm;
