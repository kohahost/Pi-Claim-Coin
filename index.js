// Impor library yang dibutuhkan
const StellarSdk = require('stellar-sdk');
const { Keypair, TransactionBuilder, Operation, Asset } = StellarSdk;
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config(); // Memuat variabel dari file .env

/**
 * Mengirim pesan notifikasi ke Telegram.
 * @param {string} message Pesan yang akan dikirim.
 */
async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (err) {
        console.error("⚠️ Gagal kirim notifikasi ke Telegram:", err.message);
    }
}

/**
 * Menghasilkan keypair Pi Wallet dari mnemonic (frasa sandi).
 * @param {string} mnemonic Frasa sandi 24 kata.
 * @returns {Promise<{publicKey: string, secretKey: string}>} Public dan Secret Key.
 */
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error(`Mnemonic tidak valid: ${mnemonic.substring(0, 10)}...`);
    }
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const { key } = ed25519.derivePath(derivationPath, seed.toString('hex'));
    const keypair = Keypair.fromRawEd25519Seed(key);
    return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Fungsi utama untuk secara atomik mengklaim balance dan mengirimkannya.
 * Proses ini menggunakan Fee-Bump Transaction yang disponsori oleh akun lain.
 */
async function claimAndSendAtomically() {
    const { MNEMONIC, SPONSOR_MNEMONIC, RECEIVER_ADDRESS } = process.env;

    if (!MNEMONIC || !SPONSOR_MNEMONIC || !RECEIVER_ADDRESS) {
        console.error("❌ Error: Pastikan MNEMONIC, SPONSOR_MNEMONIC, dan RECEIVER_ADDRESS sudah diatur di file .env");
        setImmediate(claimAndSendAtomically); // Coba lagi nanti
        return;
    }

    const server = new StellarSdk.Horizon.Server('https://mainnet.zendshost.id');
    const networkPassphrase = 'Pi Network';

    try {
        const mainWallet = await getPiWalletAddressFromSeed(MNEMONIC);
        const sponsorWallet = await getPiWalletAddressFromSeed(SPONSOR_MNEMONIC);
        const mainKeypair = Keypair.fromSecret(mainWallet.secretKey);
        const sponsorKeypair = Keypair.fromSecret(sponsorWallet.secretKey);

        const claimables = await server
            .claimableBalances()
            .claimant(mainKeypair.publicKey())
            .limit(200)
            .call();

        if (claimables.records.length > 0) {
            // Jika ada claimable balance, proses satu per satu
            for (const cb of claimables.records) {
                console.log(`\n💰 Ditemukan Claimable Balance: ${cb.amount} Pi`);

                const mainAccount = await server.loadAccount(mainKeypair.publicKey());
                const innerTransaction = new TransactionBuilder(mainAccount, { fee: '0', networkPassphrase })
                    .addOperation(Operation.claimClaimableBalance({ balanceId: cb.id }))
                    .addOperation(Operation.payment({
                        destination: RECEIVER_ADDRESS,
                        asset: Asset.native(),
                        amount: cb.amount,
                    }))
                    .setTimeout(60)
                    .build();

                innerTransaction.sign(mainKeypair);

                const baseFee = await server.fetchBaseFee();
                const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
                    sponsorKeypair.publicKey(),
                    (parseInt(baseFee) * 80).toString(),
                    innerTransaction,
                    networkPassphrase
                );

                feeBumpTransaction.sign(sponsorKeypair);

                console.log("🚀 Mengirim transaksi super cepat...");
                try {
                    const result = await server.submitTransaction(feeBumpTransaction);
                    console.log(`✅ Transaksi Sukses! Hash: ${result.hash}`);
                    console.log(`📄 Result XDR (Sukses): ${result.result_xdr}`);

                    await sendTelegramMessage(
                        `✅ **Klaim & Kirim Sukses (Sponsored)**\n*Jumlah:* ${cb.amount} Pi\n*Tx Hash:* [${result.hash.substring(0, 15)}...](https://blockexplorer.minepi.com/mainnet/transactions/${result.hash})`
                    );
                } catch (submitError) {
                    console.error("❌ Gagal submit transaksi.");
                    if (submitError.response?.data?.extras) {
                        const extras = submitError.response.data.extras;
                        console.error("   Kode Error:", extras.result_codes);
                        console.error("   Result XDR (Gagal):", extras.result_xdr);
                    } else {
                        console.error("   Pesan Error:", submitError.message);
                    }
                }
            }
        } else {
             // Log minimalis agar tidak memenuhi layar saat tidak ada apa-apa
             process.stdout.write("📭");
        }
    } catch (e) {
        const errorMessage = e.response?.data?.detail || e.response?.data?.extras?.result_codes || e.message;
        // Hanya tampilkan error jika bukan karena rate limit, untuk mengurangi noise
        if (!e.message.includes('429')) {
             console.error("\n❌ Error proses:", errorMessage);
        } else {
             process.stdout.write("⏳"); // Tanda sedang terkena rate limit
        }
    } finally {
        // PERUBAHAN UTAMA DI SINI
        // Jadwalkan eksekusi berikutnya sesegera mungkin di event loop berikutnya.
        // PERINGATAN: Ini akan menyebabkan penggunaan CPU 100%.
        setImmediate(claimAndSendAtomically);
    }
}

console.log("🚀 Memulai bot klaim Pi dalam mode SUPER CEPAT (tanpa delay)...");
console.log("⚠️ PERINGATAN: Mode ini akan menggunakan CPU 100% dan berisiko terkena rate-limit.");
claimAndSendAtomically();
