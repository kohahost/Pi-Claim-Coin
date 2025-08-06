const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config();

// Fungsi kirim notifikasi Telegram (tidak ada perubahan)
async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return; // Lewati jika tidak ada kredensial
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(url, { chat_id: chatId, text: message, parse_mode: 'Markdown' });
    } catch (err) {
        console.error("⚠️ Gagal kirim ke Telegram:", err.message);
    }
}

// Fungsi ambil key dari mnemonic (tidak ada perubahan)
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error("Invalid mnemonic");
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

// Fungsi utama yang dimodifikasi
async function claimAndSendAtomically() {
    // 1. Ambil kredensial dari .env
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

        console.log("🔑 Akun Utama:", mainKeypair.publicKey());
        console.log("💰 Akun Sponsor:", sponsorKeypair.publicKey());

        // 3. Cari claimable balances untuk akun utama
        const claimables = await server.claimableBalances().claimant(mainKeypair.publicKey()).limit(10).call();

        if (claimables.records.length === 0) {
            console.log("📭 Tidak ada claimable balance yang ditemukan.");
            return;
        }

        for (const cb of claimables.records) {
            const cbID = cb.id;
            const amount = cb.amount;
            console.log(`\n💰 Ditemukan Claimable Balance ID: ${cbID}`);
            console.log(`💸 Jumlah yang akan diklaim & dikirim: ${amount} Pi`);

            // 4. Load akun untuk mendapatkan sequence number terbaru
            const mainAccount = await server.loadAccount(mainKeypair.publicKey());
            const sponsorAccount = await server.loadAccount(sponsorKeypair.publicKey());

            // 5. Buat Transaksi Dalam (Inner Transaction)
            //    - Sumber: Akun Utama
            //    - Operasi: Klaim + Kirim
            //    - Fee: 0 (karena akan dibayar sponsor)
            const innerTransaction = new StellarSdk.TransactionBuilder(mainAccount, {
                fee: '0', // Fee DITANGGUNG SPONSOR
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
            .setTimeout(60)
            .build();

            // Akun utama menandatangani transaksi dalam
            innerTransaction.sign(mainKeypair);

            // 6. Buat Transaksi Luar (Fee-Bump Transaction)
            //    - Sumber: Akun Sponsor
            //    - Membungkus: Transaksi Dalam
            //    - Fee: Ditentukan oleh jaringan, dibayar oleh sponsor
            const fee = (await server.fetchBaseFee()).toString();
            const feeBumpTransaction = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
                sponsorAccount,
                fee,
                innerTransaction,
                networkPassphrase
            );
            
            // Akun sponsor menandatangani transaksi luar
            feeBumpTransaction.sign(sponsorKeypair);

            // 7. Kirim transaksi ke jaringan
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
        const errorMessage = e.response?.data?.extras?.result_codes || e.message || e;
        console.error("❌ Error:", errorMessage);
        await sendTelegramMessage(`❌ **Terjadi Error:**\n\`\`\`\n${JSON.stringify(errorMessage, null, 2)}\n\`\`\``);
    } finally {
        console.log("----------------------------------------------------------------");
        // Ulangi proses setiap 5 detik untuk tidak membebani server
        setTimeout(claimAndSendAtomically, 1); 
    }
}

// Mulai proses
claimAndSendAtomically();
