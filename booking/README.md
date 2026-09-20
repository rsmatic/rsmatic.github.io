# Aby's 41st — Booking System

Seat reservation at RSVP para sa kaarawan ni **Mary Abegail "Aby" Matic** (Oktubre 25, 2026).

- **Mga page** — static, naka-host sa GitHub Pages: <https://rsmatic.github.io/booking/>
- **Data** — Cloudflare Worker + D1, libre at laging bukas kahit patay ang PC mo
- **Backup** — may *Export JSON* button, at may kambal na lokal na server na JSON file ang database

---

## Bakit hindi puro GitHub Pages

Static hosting lang ang GitHub Pages — walang tumatakbong server doon, kaya walang makakasulat
ng sagot ng bisita. Ang mga page ay nasa GitHub Pages pa rin; ang Cloudflare Worker na lang ang
nagse-save ng data. Isang linya sa [`app/config.js`](app/config.js) ang nag-uugnay sa dalawa.

```
https://rsmatic.github.io/booking/        GitHub Pages (static)
  ├── index.html    admin console
  ├── i.html        page ng bisita
  └── app/config.js  ←  dito nakasulat ang URL ng Worker
              │
              │  fetch()
              ▼
https://aby41-api.rsmatic-dev.workers.dev      Cloudflare Worker (libre)
  └── D1 (SQLite)  ←  ANG DATABASE
```

---

## Setup ng Cloudflare (isang beses lang)

Kailangan ng libreng Cloudflare account. Lahat ng command ay mula sa `booking/` folder.

```bash
cd booking

# 1. Mag-login (magbubukas ng browser)
npx wrangler login

# 2. Gumawa ng D1 database
npx wrangler d1 create aby41
```

Magbibigay ito ng `database_id`. **I-paste iyon sa [`worker/wrangler.toml`](worker/wrangler.toml)**,
kapalit ng `PALITAN_NG_TUNAY_NA_ID`.

```bash
# 3. Ilagay ang mga table at ang event ni Aby
npx wrangler d1 execute aby41 --remote --file=worker/schema.sql --config worker/wrangler.toml

# 4. Itakda ang admin key (ito ang ipapasok mo sa admin page — huwag ibahagi)
npx wrangler secret put ADMIN_KEY --config worker/wrangler.toml
```

**5. Magparehistro ng `workers.dev` subdomain.** Isang beses lang ito at sa dashboard
lang magagawa — hindi ito kayang gawin ng wrangler:

<https://dash.cloudflare.com/2f2467d11ed71e4aacff8ab7155252a5/workers/onboarding>

Ang subdomain mo ay `rsmatic-dev`, kaya ang address ng Worker ay `https://aby41-api.rsmatic-dev.workers.dev`.

```bash
# 6. I-deploy
npx wrangler deploy --config worker/wrangler.toml
```

Magbibigay ang huling command ng URL, halimbawa `https://aby41-api.rsmatic-dev.workers.dev`.

**Huling hakbang:** i-paste ang URL na iyon sa [`app/config.js`](app/config.js):

```js
window.ABY_CONFIG = {
  api: 'https://aby41-api.rsmatic-dev.workers.dev',
};
```

Tapos:

```bash
git add -A && git commit -m "Point booking front-end at the Worker" && git push
```

Pagkatapos ng ilang minuto, gagana na ang <https://rsmatic.github.io/booking/>.

> Kung magpapalit ka ng domain o magda-dagdag ng bagong address, idagdag ito sa
> `ALLOWED_ORIGINS` sa `worker/wrangler.toml` at mag-deploy ulit — kung hindi, hahadlangan
> ito ng CORS.

---

## Ang daloy

1. **Gumawa ng event** sa admin — o gamitin na lang ang naka-handa nang `Aby's 41st Birthday`.
2. **Pumili ng tema** — sampung tema ang mapagpipilian (anim na madilim, apat na maliwanag).
   Agad itong nakikita sa admin, at iyon din ang makikita ng bisita sa imbitasyon nila.
3. **Gumawa ng slots** — isang slot = isang upuan. Bawat pindot ay gumagawa ng buong mesa
   (halimbawa: `Table 1`, 10 upuan).
4. **Ilagay ang pangalan ng bisita** sa bawat upuan. Awtomatikong nase-save.
5. **Kopyahin ang link o ang buong mensahe**, tapos i-paste sa Messenger o Viber.
   Isang link = isang upuan, kaya hindi pwedeng magkapalit ang mga bisita.
6. **Sasagot ang bisita** sa link — *Yes, I can come* o *Sorry, I cannot come* na may dahilan.
7. **Mag-lo-lock ang upuan** sa admin board. Nagre-refresh ito kada 15 segundo, kaya lalabas ang
   sagot kahit hindi mo pindutin ang refresh.

Ganito ang hugis ng link ng bisita:

```
https://rsmatic.github.io/booking/i.html?t=8Kd2mPqR4xVnT
```

### Tema

Sampu ang pagpipilian, naka-save sa event kaya bawat event ay may sarili nitong hitsura:

| Madilim | Maliwanag |
|---|---|
| `rose-gold` (default), `midnight`, `emerald`, `burgundy`, `noir`, `tropical` | `ivory`, `blush`, `sage`, `lavender` |

Ang bawat tema ay nagtatakda ng 13 token lang (`--ink`, `--gold`, `--text`, `--ok`, …) sa
[`app/styles.css`](app/styles.css). Ang lahat ng panel tint, border at hover ay
hinahalo mula sa mga iyon gamit ang `color-mix()`, kaya hindi na kailangang ulitin
ng bagong tema ang bawat component — at gumagana ito sa maliwanag na background gaya sa madilim.

Para magdagdag ng tema: magdagdag ng bloke sa `app/styles.css`, ng entry sa
[`app/themes.js`](app/themes.js), at ng id sa `THEMES` sa
[`api/core.js`](api/core.js). May test na tumitiyak na magkatugma ang huling dalawa.

### Edad sa imbitasyon

Sa **Step 2 — Event Details** may *Age on the invitation* na tatlo ang pagpipilian:

| Pagpipilian | Ang malaking linya sa itaas ng pangalan | Ang subtitle |
|---|---|---|
| **Show the age** (default) | `41` | `Aby's 41st Birthday Celebration` |
| **Show my own wording** | ang sarili mong text, hal. `Fourtis` | `Aby's Birthday Celebration` |
| **Hide it** | wala | `Aby's Birthday Celebration` |

Hanggang 40 karakter ang sariling wording, at mas maliit ang font nito kaysa sa numero
para kasya ang salita sa cellphone.

### Link ng mapa

May **Map link** na field sa detalye ng event. Kapag may laman, may lalabas na
*Open the venue in Maps* na button sa imbitasyon ng bisita.

Ang `http://` at `https://` lang ang tinatanggap — ang `javascript:` at `data:` ay
tinatanggihan ng server nang may 400, at sinusuri ulit ng page bago gawing `href`.
Ang bare na `maps.app.goo.gl/xxx` ay awtomatikong ginagawang `https://`.

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

## Pagbabago ng schema

Kapag may naidagdag na column, may file sa [`worker/migrations/`](worker/migrations/).
Patakbuhin ang bawat isa nang isang beses, ayon sa pagkakasunod.
Laban sa production database:

```bash
npx wrangler d1 execute aby41 --remote --file=worker/migrations/0001-theme-and-map.sql --config worker/wrangler.toml
npx wrangler d1 execute aby41 --remote --file=worker/migrations/0002-age-label.sql --config worker/wrangler.toml
```

Para sa bagong database, sapat na ang `schema.sql` — nandoon na ang lahat ng column.

## Backup

Dalawang paraan:

- **Export JSON** na button sa admin header — nagda-download ng isang file na naglalaman ng
  lahat ng event, upuan at sagot.
- Buong database mula sa Cloudflare:

  ```bash
  npx wrangler d1 export aby41 --remote --output=aby41-backup.sql --config worker/wrangler.toml
  ```

Sulit mag-backup pagkatapos ng bawat batch ng confirmation.

---

## Lokal na pagpapatakbo (opsyonal)

May kambal na Node server na kaparehong API pero JSON file ang database. Para sa pag-test,
o kung gusto mong may kopya ka sa PC mo.

```bash
node server/server.js
# http://localhost:3000  — admin key: aby1025
```

Ang database nito ay `server/data/db.json` — hindi ito kasama sa git, kaya hindi ito mapupunta
sa GitHub Pages kasama ang pangalan at token ng mga bisita.

Sa lokal, iwanang `api: ''` sa `app/config.js` — kapareho kasi ng origin ang API.

### Test suite

```bash
node server/server.js          # isang terminal
node test/e2e.js               # isa pa

node test/admin-form.js        # hindi kailangan ng server
```

Pwede ring patakbuhin laban sa tunay na Worker:

```bash
API=https://aby41-api.rsmatic-dev.workers.dev KEY=ang-key-mo node test/e2e.js
```

---

## Istraktura

```
booking/
├── index.html            Admin console          ← /booking/
├── i.html                Page ng bisita         ← /booking/i.html?t=TOKEN
├── app/
│   ├── config.js         URL ng API (ito lang ang binabago pagka-deploy)
│   ├── themes.js         Ang sampung tema na makikita sa picker
│   ├── admin.js
│   ├── invite.js
│   └── styles.css
├── api/core.js           Lahat ng logic ng API — iisa para sa Worker at sa Node
├── worker/
│   ├── wrangler.toml     Config ng Cloudflare
│   ├── schema.sql        Mga table + ang event ni Aby
│   ├── migrations/       Mga pagbabago sa schema ng umiiral nang database
│   └── src/
│       ├── index.js      Entry point ng Worker (CORS, routing)
│       └── d1-store.js   Storage sa D1
├── server/
│   ├── server.js         Lokal na server (static + API)
│   ├── file-store.js     Storage sa JSON file
│   └── data/db.json      Lokal na database (hindi naka-commit)
└── test/
    ├── e2e.js            62 API checks laban sa tumatakbong server
    └── admin-form.js     7 check sa admin form, walang browser na kailangan
```

Iisa ang `api/core.js` para sa dalawang backend, kaya hindi sila magkakaiba ng ugali —
kung ano ang na-test sa lokal, iyon din ang tumatakbo sa Cloudflare.

---

## API

Kailangan ng header na `x-admin-key` ang mga admin endpoint. Ang guest endpoint ay hindi.

| Method | Path | Para saan |
|---|---|---|
| `POST` | `/api/session` | Suriin ang admin key |
| `GET` | `/api/events` | Lahat ng event at slot |
| `POST` | `/api/events` | Gumawa ng event |
| `PATCH` | `/api/events/:id` | I-update ang event (kasama ang `theme` at `venueMapUrl`) |
| `DELETE` | `/api/events/:id` | Burahin ang event at mga slot nito |
| `POST` | `/api/events/:id/slots` | Gumawa ng slots — `{ table, count, startAt }` |
| `DELETE` | `/api/events/:id/slots` | Burahin ang LAHAT ng upuan ng event (mananatili ang event) |
| `PATCH` | `/api/slots/:id` | Pangalan, contact, mesa, upuan |
| `POST` | `/api/slots/:id/token` | Bagong link (pinapatay ang luma) |
| `POST` | `/api/slots/:id/reset` | Burahin ang sagot ng bisita |
| `DELETE` | `/api/slots/:id` | Alisin ang upuan |
| `GET` | `/api/export` | Buong database bilang JSON |
| `GET` | `/api/invite/:token` | Detalye ng imbitasyon (pampubliko) |
| `POST` | `/api/invite/:token` | Sagot — `{ attending, reason, message }` |

---

## Mga dapat tandaan

- Pampubliko ang admin page — ang `ADMIN_KEY` ang nag-iisang harang. Gumamit ng mahabang key
  at itago ito bilang Worker secret, hindi sa code.
- Ang link ng bisita ay may 13-character random token (~75 bits) — hindi ito mahuhulaan.
  Pero sinumang makakuha ng link ay pwedeng sumagot para sa upuang iyon, gaya ng ordinaryong
  RSVP link. Kung may namali, gumawa ng bagong link para sa upuan.
- Hindi kasama sa git ang `server/data/`, kaya walang pangalan ng bisita na napupunta sa
  GitHub. Kung mag-backup ka gamit ang Export JSON, huwag i-commit ang file na iyon.
- Walang email o SMS dito. Ikaw ang nagpapadala ng link sa Messenger o Viber.
