// Collects a launch wallet's creator fees from BOTH places Pump keeps them, straight from the launch wallet:
//   1. the bonding-curve creator vault (SOL)            → Pump program "collect_creator_fee"
//   2. the PumpSwap creator vault after graduation (WSOL) → PumpSwap "collect_coin_creator_fee", then unwrap to SOL
// Every transaction is simulated first; if our own instructions don't simulate, it falls back to PumpPortal.
const crypto = require('crypto');
const { decrypt, rpc } = require('./db');
const { b58decode, collectCreatorFee } = require('./solana');

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL = 'So11111111111111111111111111111111111111112';
const disc = (name) => crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8);

async function collectAll(L) {
  const W = require('@solana/web3.js');
  const T = require('@solana/spl-token');
  const conn = new W.Connection(RPC, 'confirmed');
  const kp = W.Keypair.fromSecretKey(b58decode(decrypt(L.escrow_private_key)));
  const me = kp.publicKey;
  const pump = new W.PublicKey(PUMP), amm = new W.PublicKey(PUMP_AMM), wsol = new W.PublicKey(WSOL);
  const [curveVault] = W.PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), me.toBuffer()], pump);
  const [pumpEvents] = W.PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], pump);
  const [ammAuth] = W.PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), me.toBuffer()], amm);
  const [ammEvents] = W.PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], amm);
  const ammVaultAta = T.getAssociatedTokenAddressSync(wsol, ammAuth, true);
  const myWsol = T.getAssociatedTokenAddressSync(wsol, me, false);

  const out = { curve_sol: 0, amm_sol: 0, steps: [] };
  try { const b = await conn.getBalance(curveVault, 'confirmed'); out.curve_sol = Math.max(0, b - 890880) / 1e9; } catch {}
  try { out.amm_sol = +(await conn.getTokenAccountBalance(ammVaultAta, 'confirmed')).value.uiAmount || 0; } catch {}
  if (out.curve_sol < 0.0005 && out.amm_sol < 0.0005) { out.steps.push('nothing to collect'); return out; }

  const ixs = [W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }), W.ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })];
  if (out.curve_sol >= 0.0005) {
    ixs.push(new W.TransactionInstruction({ programId: pump, data: disc('collect_creator_fee'), keys: [
      { pubkey: me, isSigner: true, isWritable: true },
      { pubkey: curveVault, isSigner: false, isWritable: true },
      { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: pumpEvents, isSigner: false, isWritable: false },
      { pubkey: pump, isSigner: false, isWritable: false },
    ] }));
  }
  if (out.amm_sol >= 0.0005) {
    ixs.push(T.createAssociatedTokenAccountIdempotentInstruction(me, myWsol, me, wsol));
    ixs.push(new W.TransactionInstruction({ programId: amm, data: disc('collect_coin_creator_fee'), keys: [
      { pubkey: wsol, isSigner: false, isWritable: false },
      { pubkey: T.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: me, isSigner: true, isWritable: false },
      { pubkey: ammAuth, isSigner: false, isWritable: false },
      { pubkey: ammVaultAta, isSigner: false, isWritable: true },
      { pubkey: myWsol, isSigner: false, isWritable: true },
      { pubkey: ammEvents, isSigner: false, isWritable: false },
      { pubkey: amm, isSigner: false, isWritable: false },
    ] }));
    ixs.push(T.createCloseAccountInstruction(myWsol, me, me)); // unwrap: WSOL → plain SOL in the launch wallet
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new W.Transaction({ feePayer: me, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(kp);
  const sim = await conn.simulateTransaction(tx);
  if (!sim.value.err) {
    out.sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
    out.steps.push('collected directly');
    for (let i = 0; i < 6; i++) { const s = (await conn.getSignatureStatuses([out.sig])).value[0]; if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) { out.confirmed = !s.err; break; } await new Promise((r) => setTimeout(r, 1000)); }
    return out;
  }
  out.sim_error = JSON.stringify(sim.value.err) + ' ' + (sim.value.logs || []).filter((l) => /error|failed|Error/i.test(l)).slice(-3).join(' | ');
  // fallback: PumpPortal's own collect (covers whatever it supports)
  try { await collectCreatorFee(decrypt(L.escrow_api_key)); out.steps.push('pumpportal collect'); await new Promise((r) => setTimeout(r, 2500)); } catch (e) { out.steps.push('pumpportal failed: ' + e.message.slice(0, 120)); }
  return out;
}

module.exports = { collectAll };
