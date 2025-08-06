// =================================================================
// KODE FINAL DEFINITIF - DENGAN METODE IMPOR YANG DIPERBAIKI
// =================================================================
// Deskripsi:
// Kode ini menggunakan metode impor modern (destructuring) untuk
// memastikan semua komponen Stellar SDK berfungsi dengan benar.
// =================================================================

// --- BAGIAN YANG DIPERBAIKI ---
// Impor komponen yang dibutuhkan secara langsung, bukan seluruh library.
const { Server, Keypair, TransactionBuilder, Operation, Asset, FeeBumpTransactionBuilder } = require('stellar-sdk');
// --- ---------------------- ---

const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config();

/**
 * Mengirim notifikasi ke Telegram.
 */
async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(url, { chat_id: chatId, text: message, parse_mode: 'Markdown' });
    } catch (err) {
        console.error("⚠️ Gagal kirim ke Telegram:", err.message);
    }
}

/**
 * Mendapatkan kunci dari mnemonic.
 */
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error(`Mnemonic tidak valid: ${mnemonic.substring(0, 10)}...`);
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const { key } = ed25519.derivePath(derivationPath, seed.toString('hex'));
    const keypair = Keypair.fromRawEd25519Seed(key); // Menggunakan Keypair langsung
    return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Fungsi utama bot.
 */
async function claimAndSendAtomically() {
    const { MNEMONIC, SPONSOR_MNEMONIC, RECEIVER_ADDRESS } = process.env;

    if (!MNEMONIC || !SPONSOR_MNEMONIC || !RECEIVER_ADDRESS) {
        console.error("❌ Error: Pastikan MNEMONIC, SPONSOR_MNEMONIC, dan RECEIVER_ADDRESS sudah diatur di file .env");
        return;
    }

    // Menggunakan Server langsung, bukan StellarSdk.Server
    const server = new Server('https://apimainnet.vercel.app');
    const networkPassphrase = 'Pi Network';

    try {
        const mainWallet = await getPiWalletAddressFromSeed(MNEMONIC);
        const sponsorWallet = await getPiWalletAddressFromSeed(SPONSOR_MNEMONIC);
        const mainKeypair = Keypair.fromSecret(mainWallet.secretKey);
        const sponsorKeypair = Keypair.fromSecret(sponsorWallet.secretKey);

        console.log("🔑 Akun Utama  :", mainKeypair.publicKey());
        console.log("💰 Akun Sponsor:", sponsorKeypair.publicKey());
        
        const claimables = await server.claimableBalances().claimant(mainKeypair.publicKey()).limit(10).call();
        if (claimables.records.length === 0) {
            console.log("📭 Tidak ada claimable balance yang ditemukan. Mengecek lagi...");
            return;
        }

        for (const cb of claimables.records) {
            console.log(`\n💰 Ditemukan Claimable Balance: ${cb.amount} Pi`);
            
            const mainAccount = await server.loadAccount(mainKeypair.publicKey());
            const sponsorAccount = await server.loadAccount(sponsorKeypair.publicKey());
            
            const innerTransaction = new TransactionBuilder(mainAccount, { // Menggunakan TransactionBuilder langsung
                fee: '0',
                networkPassphrase,
            })
            .addOperation(Operation.claimClaimableBalance({ balanceId: cb.id })) // Menggunakan Operation langsung
            .addOperation(Operation.payment({
                destination: RECEIVER_ADDRESS,
                asset: Asset.native(), // Menggunakan Asset langsung
                amount: cb.amount,
            }))
            .setTimeout(60).build();
            innerTransaction.sign(mainKeypair);

            const baseFee = await server.fetchBaseFee();
            const feeBumpTransaction = new FeeBumpTransactionBuilder(innerTransaction, { // Menggunakan FeeBumpTransactionBuilder langsung
                feeSource: sponsorAccount,
                fee: (parseInt(baseFee) * 2).toString(),
            }).build();
            feeBumpTransaction.sign(sponsorKeypair);

            console.log("🚀 Mengirim transaksi gabungan...");
            const result = await server.submitTransaction(feeBumpTransaction);
            
            console.log(`✅ Sukses! Hash: ${result.hash}`);
            await sendTelegramMessage(`✅ **Klaim & Kirim Sukses (Sponsored)**\n*Jumlah:* ${cb.amount} Pi\n*Tx Hash:* [${result.hash.substring(0,15)}...](https://blockexplorer.minepi.com/mainnet/transactions/${result.hash})`);
        }
    } catch (e) {
        const errorMessage = e.response?.data?.extras?.result_codes || e.message || JSON.stringify(e);
        console.error("❌ Error:", errorMessage);
        await sendTelegramMessage(`❌ **Terjadi Error:**\n\`\`\`\n${JSON.stringify(errorMessage, null, 2)}\n\`\`\``);
    } finally {
        console.log("----------------------------------------------------------------");
        setTimeout(claimAndSendAtomically, 1);
    }
}

// =================================================================
// Mulai proses bot
// =================================================================
console.log("🚀 Memulai bot klaim Pi dengan biaya sponsor (Versi Definitif)...");
claimAndSendAtomically();
