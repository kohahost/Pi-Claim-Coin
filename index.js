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
    if (!botToken || !chatId) return; // Jangan lakukan apa-apa jika token/chatId tidak ada

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

    // Validasi variabel environment
    if (!MNEMONIC || !SPONSOR_MNEMONIC || !RECEIVER_ADDRESS) {
        console.error("❌ Error: Pastikan MNEMONIC, SPONSOR_MNEMONIC, dan RECEIVER_ADDRESS sudah diatur di file .env");
        return;
    }

    const server = new StellarSdk.Horizon.Server('http://81.240.60.124:31401');
    const networkPassphrase = 'Pi Network';

    try {
        // Hasilkan keypair dari mnemonic
        const mainWallet = await getPiWalletAddressFromSeed(MNEMONIC);
        const sponsorWallet = await getPiWalletAddressFromSeed(SPONSOR_MNEMONIC);
        const mainKeypair = Keypair.fromSecret(mainWallet.secretKey);
        const sponsorKeypair = Keypair.fromSecret(sponsorWallet.secretKey);

        // Cari claimable balances untuk akun utama
        const claimables = await server
            .claimableBalances()
            .claimant(mainKeypair.publicKey())
            .limit(10) // Ambil hingga 10 claimable balances
            .call();

        if (claimables.records.length === 0) {
            console.log("📭 Tidak ada claimable balance yang tersedia saat ini.");
            return;
        }

        // Proses setiap claimable balance yang ditemukan
        for (const cb of claimables.records) {
            console.log(`\n💰 Ditemukan Claimable Balance: ${cb.amount} Pi (ID: ${cb.id.substring(0,12)}...)`);

            const mainAccount = await server.loadAccount(mainKeypair.publicKey());

            // Buat transaksi dalam (inner transaction) yang akan disponsori
            const innerTransaction = new TransactionBuilder(mainAccount, {
                fee: '0', // Fee ditanggung sponsor, jadi di sini 0
                networkPassphrase,
            })
            .addOperation(Operation.claimClaimableBalance({ balanceId: cb.id }))
            .addOperation(Operation.payment({
                destination: RECEIVER_ADDRESS,
                asset: Asset.native(),
                amount: cb.amount, // Kirim seluruh jumlah yang diklaim
            }))
            .setTimeout(60)
            .build();

            // Tandatangani transaksi dalam dengan akun utama
            innerTransaction.sign(mainKeypair);

            // Buat Fee-Bump Transaction untuk membungkus dan mensponsori transaksi dalam
            const baseFee = await server.fetchBaseFee();
            const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
                sponsorKeypair.publicKey(), // Akun sponsor yang membayar fee
                (parseInt(baseFee) * 80).toString(), // Fee sponsor (dibuat lebih besar untuk prioritas)
                innerTransaction,
                networkPassphrase
            );

            // Tandatangani transaksi fee-bump dengan akun sponsor
            feeBumpTransaction.sign(sponsorKeypair);

            console.log("🚀 Mengirim transaksi yang disponsori...");
            try {
                const result = await server.submitTransaction(feeBumpTransaction);

                // --- INI BAGIAN YANG ANDA CARI ---
                console.log(`✅ Transaksi Sukses! Hash: ${result.hash}`);
                console.log(`📄 Result XDR (Sukses): ${result.result_xdr}`); // Menampilkan ResultXDR saat sukses

                await sendTelegramMessage(
                    `✅ **Klaim & Kirim Sukses (Sponsored)**\n*Jumlah:* ${cb.amount} Pi\n*Tx Hash:* [${result.hash.substring(0, 15)}...](https://blockexplorer.minepi.com/mainnet/transactions/${result.hash})`
                );
            } catch (submitError) {
                // Penanganan error saat submit yang lebih detail
                console.error("❌ Gagal submit transaksi.");
                if (submitError.response?.data?.extras) {
                    const extras = submitError.response.data.extras;
                    console.error("   Kode Error:", extras.result_codes);

                    // --- INI BAGIAN YANG ANDA CARI SAAT GAGAL ---
                    console.error("   Result XDR (Gagal):", extras.result_xdr); // Menampilkan ResultXDR saat gagal
                } else {
                    console.error("   Pesan Error:", submitError.message);
                }
            }
        }
    } catch (e) {
        // Menangkap error umum seperti akun tidak ditemukan, masalah koneksi, dll.
        const errorMessage = e.response?.data?.detail || e.response?.data?.extras?.result_codes || e.message;
        console.error("❌ Terjadi error pada proses utama:", errorMessage);
    } finally {
        // Jadwalkan eksekusi berikutnya setelah 1 detik.
        // Ini lebih baik daripada setImmediate untuk mencegah penggunaan CPU yang tinggi.
        console.log("\n... Menunggu 1 detik sebelum pengecekan berikutnya ...");
        setTimeout(claimAndSendAtomically, 1000);
    }
}

// Memulai bot
console.log("🚀 Memulai bot klaim Pi...");
claimAndSendAtomically();
