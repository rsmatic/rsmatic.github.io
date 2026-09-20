# Aby's 41st — Booking System

Seat reservation at RSVP para sa kaarawan ni **Mary Abegail "Aby" Matic** (Oktubre 25, 2026).
Walang dependency — `node server.js` lang at tumatakbo na. Ang database ay tunay na JSON file:
[`data/db.json`](data/db.json).

---

## Paano patakbuhin

```bash
cd booking
node server.js
```

Buksan ang **http://localhost:3000/admin**. Ang default admin key ay `aby1025`.

Palitan ang key bago ipa-online:

```bash
# Windows PowerShell
$env:ADMIN_KEY = "kahit-anong-lihim"; node server.js

# Git Bash / Linux / Mac
ADMIN_KEY="kahit-anong-lihim" node server.js
```

Pwede ring palitan ang port: `PORT=8080 node server.js`.

---

## Ang daloy

1. **Gumawa ng event** sa admin — o gamitin na lang ang naka-handa nang `Aby's 41st Birthday`.
2. **Gumawa ng slots** — isang slot = isang upuan. Bawat pindot ay gumagawa ng buong mesa
   (halimbawa: `Table 1`, 10 upuan).
3. **Ilagay ang pangalan ng bisita** sa bawat upuan. Awtomatikong nase-save habang nagta-type ka.
4. **Kopyahin ang link o ang buong mensahe**, tapos i-paste sa Messenger o Viber.
   Isang link = isang upuan (`/i/<token>`), kaya hindi pwedeng magkapalit ang mga bisita.
5. **Sasagot ang bisita** sa link — *Oo, makakarating ako* o *Hindi ako makakarating* na may dahilan.
6. **Mag-lo-lock ang upuan** sa admin board. Nagre-refresh ito kada 15 segundo, kaya lalabas ang
   sagot kahit hindi mo pindutin ang refresh.

### Mga status ng upuan

| Status | Ibig sabihin |
|---|---|
| `open` | Bakante — wala pang nakatalagang pangalan |
| `invited` | May pangalan na, hinihintay pa ang sagot |
| `confirmed` | Naka-lock — darating ang bisita |
| `declined` | Hindi makakarating, may naitalang dahilan |

Kapag binura mo ang pangalan sa isang upuan, babalik ito sa `open` at mabubura rin ang lumang sagot.
Kung may maling link na naipadala, pindutin ang **Bagong link** — hindi na gagana ang luma.

---

## Ang link na ipapadala sa bisita

Default ay `http://localhost:3000/i/<token>` — gumagana lang ito sa PC mo.
Para maabot ito ng mga bisita, kailangan ng pampublikong address. Piliin ang isa:

**A. Tunnel papunta sa PC mo (pinakamabilis, libre)**

```bash
# hiwalay na terminal habang tumatakbo ang server
npx cloudflared tunnel --url http://localhost:3000
```

Magbibigay ito ng URL tulad ng `https://xxxx.trycloudflare.com`. I-paste iyon sa
**Hakbang 4 — Public base URL** sa admin, at doon na kukunin ang mga link.
Tandaan: gumagana lang habang nakabukas ang PC mo at ang tunnel.

**B. I-deploy sa hosting na may persistent disk** (Railway volume, Fly.io volume, VPS).
I-mount ang disk sa `booking/data/` para hindi mabura ang `db.json` tuwing redeploy.

> Hindi ito kayang i-host ng GitHub Pages — static hosting lang iyon, at kailangan ng
> tumatakbong server para may makasulat sa `db.json`.

---

## Backup

Ang buong sistema ay nasa isang file. Kopyahin lang ito:

```bash
cp data/db.json data/db.backup.json
```

Bago ang event, sulit mag-backup pagkatapos ng mga bagong confirmation.

---

## Istraktura

```
booking/
├── server.js          HTTP server + API (zero dependencies)
├── lib/db.js          JSON file storage — atomic writes, serialized transactions
├── data/db.json       ANG DATABASE
└── public/
    ├── admin.html     Admin console
    ├── admin.js
    ├── invite.html    Ang nakikita ng bisita
    ├── invite.js
    └── styles.css
```

### Hugis ng record

```json
{
  "events": [
    {
      "id": "evt_aby41",
      "title": "Aby's 41st Birthday",
      "celebrant": "Mary Abegail Matic",
      "nickname": "Aby",
      "birthDate": "1985-10-25",
      "eventDate": "2026-10-25",
      "startTime": "18:00",
      "venue": "",
      "dressCode": "",
      "note": "",
      "rsvpDeadline": "2026-10-18",
      "hostName": "Rexter Matic"
    }
  ],
  "slots": [
    {
      "id": "slt_1a2b3c4d5e",
      "eventId": "evt_aby41",
      "table": "Table 1",
      "seat": "1",
      "label": "Table 1 · Seat 1",
      "guestName": "Juan Dela Cruz",
      "guestContact": "09171234567",
      "token": "m947759XdTjC",
      "status": "confirmed",
      "reason": null,
      "message": "Happy birthday Aby!",
      "respondedAt": "2026-10-01T09:12:44.001Z"
    }
  ]
}
```

---

## API

Ang mga admin endpoint ay kailangan ng header na `x-admin-key`. Ang guest endpoint ay hindi.

| Method | Path | Para saan |
|---|---|---|
| `POST` | `/api/session` | Suriin ang admin key |
| `GET` | `/api/events` | Lahat ng event at slot |
| `POST` | `/api/events` | Gumawa ng event |
| `PATCH` | `/api/events/:id` | I-update ang event |
| `DELETE` | `/api/events/:id` | Burahin ang event at mga slot nito |
| `POST` | `/api/events/:id/slots` | Gumawa ng slots — `{ table, count, startAt }` |
| `PATCH` | `/api/slots/:id` | Pangalan, contact, mesa, upuan |
| `POST` | `/api/slots/:id/token` | Bagong link (pinapatay ang luma) |
| `POST` | `/api/slots/:id/reset` | Burahin ang sagot ng bisita |
| `DELETE` | `/api/slots/:id` | Alisin ang upuan |
| `GET` | `/api/invite/:token` | Detalye ng imbitasyon (pampubliko) |
| `POST` | `/api/invite/:token` | Sagot — `{ attending, reason, message }` |

---

## Mga dapat tandaan

- Ang admin key ang nag-iisang harang sa admin console. Palitan ito bago ilagay online.
- Ang link ng bisita ay hulaan-proof (72-bit random token), pero sinumang makakuha ng link
  ay pwedeng sumagot para sa upuang iyon — gaya ng ordinaryong RSVP link.
- Walang email o SMS dito. Ikaw ang nagpapadala ng link sa Messenger o Viber.
