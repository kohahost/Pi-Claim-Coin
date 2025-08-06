// =================================================================
// PI NETWORK - SPONSORED ATOMIC CLAIM & SEND BOT
// =================================================================
// Deskripsi:
// Bot ini secara otomatis akan:
// 1. Mengecek "claimable balance" untuk akun utama (MNEMONIC).
// 2. Jika ditemukan, bot akan membuat satu transaksi atomik yang
//    melakukan DUA hal sekaligus:
//    a. Mengklaim balance tersebut.
//    b. Mengirimkan seluruh jumlah yang diklaim ke RECEIVER_ADDRESS.
// 3. Semua biaya (fee) untuk transaksi ini akan dibayar oleh akun
//    kedua, yaitu akun SPONSOR (SPONSOR_MNEMONIC).
//
// Oleh karena itu, akun utama tidak perlu memiliki saldo Pi sama sekali
// untuk bisa menjalankan proses klaim dan kirim ini.
// =================================================================

const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config();

/**
 * Mengirim notifikasi ke Telegram.
 * @param {string} message - Pesan yang akan dikirim.
 */
async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return; // Lewati jika kredensial Telegram tidak ada

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown' // Mengaktifkan formatting seperti bold, link, dll.
        });
    } catch (err) {
        console.error("⚠️ Gagal kirim ke Telegram:", err.message);
    }
}

/**
 * Mendapatkan public key dan secret key dari mnemonic phrase.
 * @param {string} mnemonic - Mnemonic phrase (12 atau 24 kata).
 * @returns {Promise<{publicKey: string, secretKey: string}>}
 */
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error("Mnemonic tidak valid. Harap periksa kembali.");
    }
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const { key } = ed25519.derivePath(derivationPath, seed.toString('hex'));
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);
    return {
        publicKey: keypair.publicKey(),
        secretKey: keypair.secret()
    };
}

/**
 * Fungsi utama untuk mengklaim dan mengirim secara atomik dengan biaya sponsor.
 */
async function claimAndSendAtomically() {
    // 1. Ambil kredensial dari file .env
    const mainMnemonic = process.env.MNEMONIC;
    const sponsorMnemonic = process.env.SPONSOR_MNEMONIC;
    const receiverAddress = process.env.RECEIVER_ADDRESS;

    if (!mainMnemonic || !sponsorMnemonic || !receiverAddress) {
        console.error("❌ Error: Pastikan MNEMONIC, SPONSOR_MNEMONIC, dan RECEIVER_ADDRESS sudah diatur di file .env");
        return;
    }

    const server = new StellarSdk.Server('https://apimainnet.vercel.app');
    const networkPassphrase = 'Pi Network';

    try {
        // 2. Siapkan keypair untuk akun utama dan akun sponsor
        const mainWallet = await getPiWalletAddressFromSeed(mainMnemonic);
        const sponsorWallet = await getPiWalletAddressFromSeed(sponsorMnemonic);

        const mainKeypair = StellarSdk.Keypair.fromSecret(mainWallet.secretKey);
        const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorWallet.secretKey);

        console.log("🔑 Akun Utama  :", mainKeypair.publicKey());
        console.log("💰 Akun Sponsor:", sponsorKeypair.publicKey());
        console.log("🎯 Alamat Tujuan:", receiverAddress);

        // 3. Cari claimable balances untuk akun utama
        const claimables = await server.claimableBalances().claimant(mainKeypair.publicKey()).limit(10).call();

        if (claimables.records.length === 0) {
            console.log("📭 Tidak ada claimable balance yang ditemukan. Mengecek lagi...");
            return;
        }

        for (const cb of claimables.records) {
            const cbID = cb.id;
            const amount = cb.amount;
            console.log(`\n💰 Ditemukan Claimable Balance ID: ${cbID}`);
            console.log(`💸 Jumlah: ${amount} Pi`);

            // 4. Load akun untuk mendapatkan sequence number terbaru
            const mainAccount = await server.loadAccount(mainKeypair.publicKey());
            const sponsorAccount = await server.loadAccount(sponsorKeypair.publicKey());

            // 5. Buat Transaksi Dalam (Inner Transaction)
            // Ini adalah transaksi inti yang operasinya akan dieksekusi.
            // Biayanya diatur ke '0' karena akan ditanggung oleh sponsor.
            const innerTransaction = new StellarSdk.TransactionBuilder(mainAccount, {
                fee: '0', // Fee DITANGGUNG SPONSOR, jadi di sini 0
                networkPassphrase,
            })
            .addOperation(StellarSdk.Operation.claimClaimableBalance({
                balanceId: cbID,
            }))
            .addOperation(StellarSdk.Operation.payment({
                destination: receiverAddress,
                asset: StellarSdk.Asset.native(),
                amount: amount, // Langsung kirim sejumlah yang di-klaim
            }))
            .setTimeout(60) // Transaksi valid selama 60 detik
            .build();

            // Akun utama harus menandatangani transaksi yang berisi operasinya
            innerTransaction.sign(mainKeypair);

            // 6. Buat Transaksi Luar (Fee-Bump Transaction)
            // Ini adalah transaksi pembungkus yang tujuannya hanya untuk membayar biaya.
            const baseFee = await server.fetchBaseFee();
            const feeBumpTransaction = new StellarSdk.FeeBumpTransactionBuilder(innerTransaction, {
                feeSource: sponsorAccount, // Sumber biaya adalah akun sponsor
                fee: (parseInt(baseFee) * 2).toString(), // Bayar 2x base fee agar lebih cepat diproses
            })
            .build();
            
            // Akun sponsor harus menandatangani transaksi pembungkus ini
            feeBumpTransaction.sign(sponsorKeypair);

            // 7. Kirim transaksi gabungan ke jaringan
            console.log("🚀 Mengirim transaksi gabungan (klaim + kirim) dengan biaya sponsor...");
            const result = await server.submitTransaction(feeBumpTransaction);
            
            console.log(`✅ Sukses! Transaksi Hash: ${result.hash}`);
            console.log(`🔗 Lihat di Explorer: https://blockexplorer.minepi.com/mainnet/transactions/${result.hash}`);
            
            const successMessage = `
✅ **Klaim & Kirim Sukses (Sponsored)**
*Jumlah:* ${amount} Pi
*Tujuan:* \`${receiverAddress.substring(0, 10)}...\`
*Sponsor:* \`${sponsorKeypair.publicKey().substring(0, 10)}...\`
*Tx Hash:* [${result.hash.substring(0, 15)}...](https://blockexplorer.minepi.com/mainnet/transactions/${result.hash})
            `;
            await sendTelegramMessage(successMessage.trim());
        }
    } catch (e) {
        // Menangani error dengan lebih detail
        const errorMessage = e.response?.data?.extras?.result_codes || e.message || JSON.stringify(e, null, 2);
        console.error("❌ Error:", errorMessage);
        await sendTelegramMessage(`❌ **Terjadi Error:**\n\`\`\`\n${errorMessage}\n\`\`\``);
    } finally {
        console.log("----------------------------------------------------------------");
        // Ulangi proses setiap 5 detik
        setTimeout(claimAndSendAtomically, 1); 
    }
}

// =================================================================
// Mulai proses
// =================================================================
console.log("🚀 Memulai bot klaim Pi dengan biaya sponsor...");
claimAndSendAtomically();
