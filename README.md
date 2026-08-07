# Tama-Baileys

<p align="center">
  <img src="-" alt="Thumbnail" />
</p>

## Tentang Tama-Baileys

Tama-Baileys adalah library open source yang membantu developer membuat bot dan sistem otomasi WhatsApp dengan mudah. Library ini menggunakan teknologi websocket tanpa memerlukan browser, sehingga lebih ringan dan efisien.

## Info Rilis

- Versi saat ini: 2.1.2
- Fokus update: penyesuaian koneksi WhatsApp dan penanganan pesan masuk dengan JID/LID agar lebih konsisten dengan Baileys terbaru
- Status: siap digunakan dan telah dipersiapkan untuk publikasi ke GitHub

### Fitur Utama

- **Otomasi Lengkap** - Kelola pesan, chat, grup, dan kontak secara otomatis
- **Pesan Interaktif** - Buat tombol, menu dinamis, dan pesan dengan tindakan
- **Multi-Device** - Mendukung fitur multi-perangkat WhatsApp terbaru
- **Pairing Kustom** - Proses pairing yang stabil dan bisa disesuaikan
- **Manajemen Sesi** - Sesi otomatis tersimpan untuk koneksi yang andal
- **Mudah Diintegrasikan** - Ringan dan modular, cocok untuk berbagai sistem

### Cocok Untuk

- Bot bisnis dan customer service
- Sistem notifikasi otomatis
- Solusi marketing dan broadcast
- Integrasi dengan aplikasi lain
- Chatbot dengan AI

---

## Dokumentasi Pengiriman Pesan

### 1. Pesan Album (Kirim Banyak Gambar)

Kirim beberapa gambar sekaligus dalam satu pesan:

```javascript
await sock.sendMessage(jid, { 
    albumMessage: [
        { image: cihuy, caption: "Foto pertama" },
        { image: { url: "URL_GAMBAR" }, caption: "Foto kedua" }
    ] 
}, { quoted: m });
```

---

### 2. Pesan Event/Acara

Buat undangan event langsung di WhatsApp:

```javascript
await sock.sendMessage(jid, { 
    eventMessage: { 
        isCanceled: false, 
        name: "Webinar Gratis", 
        description: "Belajar coding dari nol", 
        location: { 
            degreesLatitude: -7.9666,
            degreesLongitude: 112.6326, 
            name: "Malang, Jawa Timur" 
        }, 
        joinLink: "https://call.whatsapp.com/video/abcdefgh", 
        startTime: "1763019000", 
        endTime: "1763026200", 
        extraGuestsAllowed: false 
    } 
}, { quoted: m });
```

---

### 3. Hasil Polling/Voting

Tampilkan hasil polling dengan jumlah suara:

```javascript
await sock.sendMessage(jid, { 
    pollResultMessage: { 
        name: "Pilih Menu Favorit", 
        pollVotes: [
            {
                optionName: "Nasi Goreng",
                optionVoteCount: "150"
            },
            {
                optionName: "Mie Ayam",
                optionVoteCount: "87"
            }
        ] 
    } 
}, { quoted: m });
```

---

### 4. Pesan Interaktif Sederhana

Pesan dengan tombol copy code:

```javascript
await sock.sendMessage(jid, {
    interactiveMessage: {
        title: "Kode Promo Anda",
        footer: "Berlaku hingga akhir bulan",
        buttons: [
            {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                    display_text: "Salin Kode",
                    id: "123456789",              
                    copy_code: "PROMO50"
                })
            }
        ]
    }
}, { quoted: m });
```

---

### 5. Pesan Interaktif dengan Gambar

Pesan dengan gambar mini dan tombol:

```javascript
await sock.sendMessage(jid, {
    interactiveMessage: {
        title: "Produk Terbaru",
        footer: "Stok terbatas",
        image: { url: "https://example.com/produk.jpg" },
        buttons: [
            {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                    display_text: "Salin Kode Diskon",
                    id: "123456789",
                    copy_code: "DISKON30"
                })
            }
        ]
    }
}, { quoted: m });
```

---

### 6. Pesan dengan Menu Pilihan

Pesan interaktif dengan menu dropdown dan berbagai tombol:

```javascript
await sock.sendMessage(jid, {    
    interactiveMessage: {      
        title: "Menu Utama",      
        footer: "Pilih layanan yang Anda butuhkan",      
        image: { url: "https://example.com/banner.jpg" },      
        nativeFlowMessage: {        
            messageParamsJson: JSON.stringify({          
                limited_time_offer: {            
                    text: "Diskon 50%",            
                    url: "https://example.com",            
                    copy_code: "HEMAT50",            
                    expiration_time: Date.now() + 86400000          
                },          
                bottom_sheet: {            
                    in_thread_buttons_limit: 2,            
                    divider_indices: [1, 2, 3],            
                    list_title: "Daftar Layanan",            
                    button_title: "Pilih Layanan"          
                }        
            }),        
            buttons: [          
                {            
                    name: "single_select",            
                    buttonParamsJson: JSON.stringify({              
                        title: "Pilih Menu",              
                        sections: [                
                            {                  
                                title: "Layanan Kami",                  
                                highlight_label: "Populer",                  
                                rows: [                    
                                    {                      
                                        title: "Customer Service",                      
                                        description: "Hubungi tim kami",                      
                                        id: "cs_menu"                    
                                    },
                                    {                      
                                        title: "Info Produk",                      
                                        description: "Lihat katalog lengkap",                      
                                        id: "product_menu"                    
                                    }                  
                                ]                
                            }              
                        ]            
                    })          
                },          
                {            
                    name: "cta_copy",            
                    buttonParamsJson: JSON.stringify({              
                        display_text: "Salin Kode Promo",              
                        id: "promo123",              
                        copy_code: "WELCOME2025"            
                    })          
                }        
            ]      
        }    
    }  
}, { quoted: m });
```

---

### 7. Pesan Produk/Katalog

Kirim pesan katalog produk dengan tombol beli:

```javascript
await sock.sendMessage(jid, {
    productMessage: {
        title: "Smartphone Terbaru",
        description: "Spesifikasi tinggi dengan harga terjangkau",
        thumbnail: { url: "https://example.com/phone.jpg" },
        productId: "PHONE001",
        retailerId: "STORE001",
        url: "https://example.com/product",
        body: "RAM 8GB, Storage 128GB",
        footer: "Gratis ongkir se-Indonesia",
        priceAmount1000: 3500000,
        currencyCode: "IDR",
        buttons: [
            {
                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                    display_text: "Beli Sekarang",
                    url: "https://example.com/buy"
                })
            }
        ]
    }
}, { quoted: m });
```

---

### 8. Pesan dengan Dokumen

Kirim pesan interaktif dengan file dokumen (PDF, Excel, dll):

**Catatan Penting:** File dokumen hanya bisa dikirim dari file buffer (baca dari sistem file)

```javascript
await sock.sendMessage(jid, {
    interactiveMessage: {
        title: "Laporan Bulanan",
        footer: "Dokumen rahasia - jangan disebarkan",
        document: fs.readFileSync("./laporan.pdf"),
        mimetype: "application/pdf",
        fileName: "Laporan-Januari-2025.pdf",
        jpegThumbnail: fs.readFileSync("./thumbnail.jpg"),
        buttons: [
            {
                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                    display_text: "Download Versi Lengkap",
                    url: "https://example.com/download",
                    merchant_url: "https://example.com"
                })
            }
        ]
    }
}, { quoted: m });
```

---

### 9. Permintaan Pembayaran

Kirim invoice atau tagihan pembayaran dengan background kustom:

```javascript
let quotedType = m.quoted?.mtype || '';
let quotedContent = JSON.stringify({ [quotedType]: m.quoted }, null, 2);

await sock.sendMessage(jid, {
    requestPaymentMessage: {
        currency: "IDR",
        amount: 500000,
        from: m.sender,
        sticker: JSON.parse(quotedContent),
        background: {
            id: "100",
            fileLength: "0",
            width: 1000,
            height: 1000,
            mimetype: "image/webp",
            placeholderArgb: 0xFF00FFFF,
            textArgb: 0xFFFFFFFF,     
            subtextArgb: 0xFFAA00FF   
        }
    }
}, { quoted: m });
```

---

## Kenapa Pilih Tama-Baileys?

### ✅ Kelebihan

- **Stabil & Andal** - Proses pairing yang sudah diperbaiki dan lebih stabil
- **Fitur Lengkap** - Mendukung semua jenis pesan WhatsApp terbaru
- **Mudah Digunakan** - Dokumentasi jelas dengan contoh kode siap pakai
- **Update Berkala** - Terus dikembangkan mengikuti update WhatsApp
- **Ringan & Cepat** - Tidak membebani server Anda
- **Fleksibel** - Bisa disesuaikan dengan kebutuhan bisnis Anda

### 🎯 Ideal Untuk

- Startup yang butuh bot customer service
- Perusahaan dengan sistem notifikasi otomatis
- Developer yang ingin integrasi WhatsApp ke aplikasi
- Bisnis online untuk broadcast promosi
- Komunitas untuk manajemen grup

---

## Cara Memulai

1. **Install** library melalui npm atau yarn
2. **Konfigurasi** sesuai panduan instalasi
3. **Jalankan** kode contoh untuk testing
4. **Kustomisasi** sesuai kebutuhan bisnis Anda
5. **Deploy** ke server production

---

## Catatan Teknis

- ✓ Mendukung pairing kustom yang aman
- ✓ Manajemen sesi otomatis
- ✓ Compatible dengan multi-device WhatsApp
- ✓ Support semua jenis pesan (teks, media, interaktif)
- ✓ Mudah diintegrasikan ke sistem existing
- ✓ Dokumentasi lengkap dan contoh kode

---

## Dukungan & Komunitas

Untuk dokumentasi lengkap, tutorial, dan troubleshooting, kunjungi:
- Repository resmi di GitHub
- Forum komunitas developer
- Channel Telegram untuk update terbaru

**Terima kasih telah memilih Tama-Baileys untuk solusi otomasi WhatsApp Anda! 🚀**
