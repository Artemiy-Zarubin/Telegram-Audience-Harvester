# tg-bot-audience-harvester

Сбор аудитории и базы подписчиков любого Telegram-бота через историю обновлений MTProto (`updates.getDifference`).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

[English](README.md) | [Русский](README_RU.md)

---

В официальном Bot API нет метода для выгрузки списка пользователей или подписчиков бота.

Эта библиотека подключается по протоколу MTProto от имени бота, последовательно проходит по его серверной очереди обновлений (PTS) и собирает всех пользователей, которые когда-либо писали боту или запускали его.

## Быстрый старт (CLI)

Запуск напрямую через `npx`:

```bash
export TELEGRAM_API_ID="123456"
export TELEGRAM_API_HASH="0123456789abcdef0123456789abcdef"

npx tg-bot-audience-harvester --token "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ" --csv audience.csv
```

Или через флаги в одну строку:

```bash
npx tg-bot-audience-harvester \
  --token "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ" \
  --api-id 123456 \
  --api-hash "0123456789abcdef0123456789abcdef" \
  --csv ./audience.csv \
  --json ./report.json
```

### Флаги CLI

| Флаг | Переменная | По умолчанию | Описание |
|---|---|---|---|
| `-t, --token <token>` | `BOT_TOKEN` | обязательно | Токен бота от @BotFather |
| `--api-id <id>` | `TELEGRAM_API_ID` | обязательно | API ID с my.telegram.org |
| `--api-hash <hash>` | `TELEGRAM_API_HASH` | обязательно | API Hash с my.telegram.org |
| `-p, --proxy <url>` | `PROXY_URL` | — | Прокси (`socks5://`, `http://`, `mtproxy`) |
| `-c, --csv <path>` | — | — | Путь сохранения CSV-файла |
| `-j, --json <path>` | — | — | Путь сохранения JSON-отчета |
| `-d, --delay <ms>` | — | `35` | Задержка в мс между запросами (защита от лимитов) |
| `--days <num>` | — | `7` | Порог дней оффлайна для признания активным |
| `--max-iter <num>` | — | `5000` | Максимум итераций |
| `--max-flood <sec>`| — | `300` | Максимальное время ожидания FloodWait в секундах |

---

## Использование в коде

```bash
npm install tg-bot-audience-harvester
```

### Простой вызов

```typescript
import { harvestBotAudience } from 'tg-bot-audience-harvester';

const report = await harvestBotAudience({
  apiId: 123456,
  apiHash: '0123456789abcdef0123456789abcdef',
  botToken: '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ',
  saveCsvPath: './audience.csv',
  onProgress: (p) => {
    console.log(`${p.percent}% (${p.uniqueUsers} пользователей найдено)`);
  },
});

console.log(`Собрано ${report.totalUsers} пользователей (${report.activeUsers} активных)`);
```

### Стриминг событий (для больших баз)

Если у бота огромная аудитория и не хочется держать все профили в оперативной памяти:

```typescript
import { BotAudienceHarvester } from 'tg-bot-audience-harvester';

const harvester = new BotAudienceHarvester({
  apiId: 123456,
  apiHash: '0123456789abcdef0123456789abcdef',
  botToken: '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ',
});

harvester.on('user', (user) => {
  console.log(`Пользователь: ${user.id} (@${user.username || 'нет'})`);
});

harvester.on('progress', (p) => {
  console.log(`Прогресс: ${p.percent}% (PTS: ${p.currentPts}/${p.serverPts})`);
});

const report = await harvester.start();
```

---

## Собираемые данные

Для каждого пользователя собираются:
- `id`: Telegram ID
- `firstName`, `lastName`: Имя и фамилия
- `username`: Основной юзернейм (без `@`)
- `usernames`: Все никнеймы, включая коллекционные Web3/Fragment юзернеймы
- `isPremium`: Наличие подписки Telegram Premium
- `isDeleted`: Удален ли аккаунт
- `status`: Нативный MTProto-статус (`userStatusRecently`, `userStatusOnline` и др.)
- `lastSeen`: Время последнего захода (если было видно)
- `isActive`: Активен ли пользователь (с учетом порога `activeDaysThreshold`)
- `language`: Языковой код приложения (`ru`, `en` и др.)
- `photoDcId`: ID датацентра Telegram с аватаркой

---

## Лицензия

MIT © [Artemiy Zarubin](https://github.com/Artemiy-Zarubin)
