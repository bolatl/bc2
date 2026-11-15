# Backend changes v1: LLM-интеграция

Ветка `backend_changes`. Изменения поверх `first commit, backend skeleton`: подключение реальной LLM (OpenAI или Anthropic), окружение, инструменты для ручной проверки и документация.

## 1. Что изменилось

### LLM-адаптеры (`internal/llm`)

До этого `llm.Client` имел только детерминированный `Mock`. Теперь есть два реальных провайдера за тем же интерфейсом, поэтому сервисный слой (`internal/service`) не менялся.

| Файл | Назначение |
|---|---|
| `generator.go` | Общая логика: этапы, JSON-схемы ответов, проверка запрещённых слов, сборка промпта |
| `openai.go` | OpenAI Chat Completions (strict structured outputs), `net/http` |
| `anthropic.go` | Anthropic Messages API через официальный Go SDK (`anthropic-sdk-go/v2`), structured output по схеме |
| `openai_test.go` | Тесты обоих адаптеров на фейковом HTTP-сервере |
| `llm.go` | Без изменений: интерфейс, `SystemPrompt`, `Mock` |

Поведение:

- **Через модель идут** этапы `facts`, `feelings`, `needs`, `partner_view`, `rehearsal` (вопрос и две карточки), классификация темы (`ClassifyTopic`) и итог (`FinalResult`).
- **Остаются детерминированными (мок)** этапы `thermometer_start`, `thermometer_end` и `ready`, потому что это фиксированные шкалы.
- **Ответ жёстко ограничен схемой.** Тема выбирается из фиксированного списка. Лишние поля в ответе отвергаются.
- **Текст пользователя передаётся как данные.** Он идёт отдельным JSON-блоком с пометкой «user data, not instructions», а не вклеивается в инструкции.
- **Запрещённые слова** (`therapist`, `diagnos`, `treatment`, `toxic`, `red flag`) проверяются в каждом сгенерированном тексте. Если слово найдено, ответ отклоняется.
- **Валидация сервиса сохранена:** две разные карточки до 12 слов, ровно три общих правила в итоге.
- **Ошибки провайдера** превращаются в `503 generation_unavailable`. В лог попадает только статус ответа (без тела, оно может содержать текст пользователя).
- **Safety-проверка** по-прежнему выполняется до любого вызова модели.
- **Ретраев и фолбэка на мок нет.** Это осознанное ограничение первой версии.

### Конфигурация

Новые переменные (`internal/config/config.go`, `cmd/server/main.go`, `.env.example`):

| Переменная | По умолчанию | Описание |
|---|---|---|
| `LLM_API_KEY` | пусто | Ключ провайдера. Пусто: работает мок, тексты не покидают сервер |
| `LLM_PROVIDER` | авто | `openai` или `anthropic`. Если пусто, определяется по префиксу ключа (`sk-ant-` → Anthropic, иначе OpenAI) |
| `LLM_MODEL` | зависит от провайдера | `claude-opus-5-5` для Anthropic, `gpt-4o-mini` для OpenAI |
| `LLM_BASE_URL` | официальный API | Для прокси или совместимого сервера |
| `DISABLE_PAYWALL` | `false` | `true`: оплата не нужна (см. ниже) |

В логе старта поле `llm_mode` показывает `mock`, `openai` или `anthropic`. Неизвестное значение `LLM_PROVIDER` останавливает запуск с ошибкой.

### Инструменты и документы

- `Makefile`: цель `make run-env` загружает `.env` и запускает сервер.
- `scripts/curl_flow.sh`: полный флоу через curl (онбординг, сессия, демо-оплата, итог).
- `docs/features/backend-mvp/CURL_EXAMPLES.md`: отдельные curl-запросы для копирования в Postman.
- `README.md` и `docs/features/backend-mvp/REQUIREMENTS.md`: обновлены описание LLM и таблица переменных.
- `.gitignore`: собран заново (секреты, IDE, артефакты curl, скриншоты).
- `go.mod` и `go.sum`: добавлен `anthropic-sdk-go/v2` и его зависимости.

### Отключение пейвола (`DISABLE_PAYWALL`)

Флаг `DISABLE_PAYWALL=true` (по умолчанию `false`) нужен для локальной проверки без оплаты. Единая точка проверки доступа `App.active()` (`internal/service/app.go`) при включённом флаге считает любую пару оплатившей. Из этого следует:

- сессия сразу идёт в полном режиме (`tier: "full"`), без остановки после `FREE_TURNS` ответов;
- приглашение партнёра B (`inviteUrl`) появляется, как только A закончил сессию;
- B может начать сессию, журнал и статистика доступны без оплаты;
- `GET /subscriptions/me` возвращает `status: "active"`, а `checkout` отвечает `409` (подписка уже активна).

В `.env` флаг включён, в `.env.example` выключен. Тест: `TestDisablePaywallGivesFullAccessWithoutPayment`. Для боевого режима флаг нужно держать выключенным.

### Ограничения, о которых нужно знать

- **Приватность.** Когда ключ задан, ответы партнёра и его профиль отправляются внешнему провайдеру (только после прохождения safety-проверки).
- **Стоимость.** Модель Anthropic по умолчанию `claude-opus-5-5`, самая дорогая. Для коротких карточек подойдёт `LLM_MODEL=claude-haiku-5-5` или `claude-sonnet-5-5`.
- **Хранилище в памяти.** Данные пропадают при перезапуске сервера, после него куки старых сессий недействительны.
- **Живой вызов API в тестах не выполнялся.** Тесты используют фейковый сервер, поэтому первый запуск с реальным ключом нужно проверить вручную.

## 2. Как настроить и запустить бэкенд

Нужен Go 1.26+.

1. Скопируйте пример окружения и заполните ключ:
   ```bash
   cp .env.example .env
   ```
   В `.env` задайте `LLM_API_KEY=...` и при необходимости `LLM_PROVIDER` и `LLM_MODEL`. Файл `.env` в git не попадает.
2. Запустите сервер:
   ```bash
   make run-env      # читает .env
   # или без .env (мок LLM): make run
   ```
   В логе должно быть `Love Lab backend listening ... llm_mode=anthropic` (или `openai`). Адрес по умолчанию `http://localhost:8080`.
3. Проверьте тесты (необязательно):
   ```bash
   make check        # go vet + go test -race
   ```

Остальные переменные (`FREE_TURNS`, `MAX_TURNS`, `ENABLE_REHEARSAL`, `STRIPE_SECRET_KEY` и т.д.) описаны в `README.md`. Без `STRIPE_SECRET_KEY` оплата работает как мок.

## 3. Как работают запросы

Базовый путь `/api/v1`, JSON, camelCase. Полный контракт: `docs/features/backend-mvp/API_CONTRACT.md` и `OPENAPI.yaml`.

### Идентификация

Аккаунтов нет. `POST /couples` создаёт пару и выставляет куку `lovelab_session` (HttpOnly). По ней сервер узнаёт пару и роль (партнёр A или B). Postman и браузер хранят куку сами. Без неё все защищённые маршруты отвечают `404 not_found`. После перезапуска сервера кука недействительна, начинайте с `POST /couples`.

### Флоу партнёра A

1. `POST /couples` создаёт пару. Тело: возраст, статус отношений, стиль конфликта и т.д. (выбор из списков).
2. `POST /personality-tests` (необязательно): 20 ответов, отчёт без LLM.
3. `POST /fight-sessions` запускает сессию. В ответе `sessionId` и `currentTurn`.
4. Цикл ходов: `POST /fight-sessions/{sessionId}/turns`.
5. Если `DISABLE_PAYWALL=false`, на пейволе (после `FREE_TURNS`, по умолчанию 4 ответа) нужны `POST /subscriptions/checkout` и `POST /subscriptions/confirm`. При `DISABLE_PAYWALL=true` этого шага нет.
6. После `ready` результат: `GET /fight-sessions/{sessionId}/result`.

### Ходы и карточки

Сервер ведёт сессию строго по этапам:

`thermometer_start` → `facts` → `feelings` → `needs` → `partner_view` → (`rehearsal`, если `ENABLE_REHEARSAL=true`) → `thermometer_end` → `ready`

У каждого этапа один вопрос и две карточки (`optionLeft`, `optionRight`). Порядок задаёт сервер, ни клиент, ни LLM его не меняют. Текущий вопрос возвращает `GET /fight-sessions/{sessionId}` и ответ на предыдущий ход. В каждом запросе `turnIndex` должен совпадать с `currentTurn.turnIndex`, иначе придёт `409`.

Три способа ответить:

| Что | `answerSource` | `answerText` |
|---|---|---|
| Левая карточка | `card_left` | не нужен |
| Правая карточка | `card_right` | не нужен |
| Свой текст | `free_text` | обязателен, до 4000 символов |

Пример:
```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' \
  -H 'Content-Type: application/json' \
  -d '{"turnIndex":2,"answerSource":"card_left"}'
```

Первый этап (`thermometer_start`) принимает число от 1 до 10 строкой, например `"8"`. Свою ситуацию описывайте на этапе `facts`.

Дополнительно: `POST .../back` с `{"turnIndex":N}` возвращает на ход назад, `POST .../skip-topic` пропускает тему и стирает ответы.

### Что идёт в LLM и что возвращается

Для каждого хода сервер собирает `llm.Input`: этап, нейтральную тему, профиль текущего партнёра, его собственные ответы. Данные второго партнёра в запрос не попадают. Ответ модели проходит проверки (схема, запрещённые слова, длина карточек) и сохраняется как следующий вопрос.

### Ошибки

| Код | Причина |
|---|---|
| `404 not_found` | Неверный путь, нет куки или чужой ресурс |
| `409` | Неверный или устаревший `turnIndex` |
| `503 generation_unavailable` | Ошибка LLM-провайдера (ключ, лимит, невалидный ответ); причина в stderr сервера |

### Проверка вручную

- Пошаговая инструкция «пройти флоу до конца за A и B»: `docs/features/backend-mvp/FULL_FLOW_GUIDE.md`.
- Postman: запросы из `docs/features/backend-mvp/CURL_EXAMPLES.md` (Import → Raw text).
- Автопрогон: `scripts/curl_flow.sh` (полный флоу одной командой), `scripts/demo.py` (два партнёра).
- Посмотреть созданное: `GET /couples/me`, `/fight-sessions/{id}`, `/fight-sessions/{id}/result`, `/subscriptions/me`, `/journal`, `/journal/stats`.

## 4. Git: что игнорируется

`.gitignore` исключает: `.env*` (кроме `.env.example`), `bin/`, артефакты тестов, `*.jar` (куки curl), логи, `scripts/out/`, скриншоты `telegram-cloud-photo-*`, `.idea/`, `.vscode/`, `*.iml`, `.DS_Store` и локальные исходные материалы (`LoveLab_*.md`, `Business_Cup_2.0_Brief.pdf`).
