# Музыкальное хранилище v0.11.0
FastAPI + SQLite + SQLAlchemy + Alembic (бэкенд) и React + Vite (фронтенд). Лицензия: MIT. Автор: Горобец Екатерина.

## Запуск локально (Python 3.10+, Node 18+)
**Backend** (http://localhost:8000, документация API: /docs):
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate           # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env           # Linux/macOS: cp .env.example .env
uvicorn app.main:app --reload --reload-dir app
```
При старте в консоли печатаются пути к БД и папке загрузок (`БД = … | загрузки = …`) — именно там лежат ваши треки и аватарки.
`--reload-dir app` нужен, чтобы сервер не перезапускался при записи файлов в `uploads/` и `music.db`.
Миграции Alembic применяются автоматически при старте (то же, что `alembic upgrade head`).
Если остался старый `backend/music.db` от прежних версий — удалите его, схема создаётся заново.
`.env` читается автоматически (`SECRET_KEY` обязательно смените).

**Frontend** (http://localhost:5173), в другом терминале:
```bash
cd frontend
npm install
npm run dev
```
Откройте http://localhost:5173, зарегистрируйтесь и загрузите MP3/WAV.
Публичный плейлист открывается по ссылке вида `http://localhost:5173/#/playlist/1` без входа.

## Роли и соцсеть
Роли: гость, пользователь, модератор, администратор. Первого администратора задайте в `backend/.env`: `ADMIN_EMAIL=ваш@email` (зарегистрируйтесь с этим адресом или перезапустите сервер после регистрации), остальных назначает админ в «Администрирование → Пользователи и роли». Подробно о правилах доступа и страницах — в `PAGES.md`.
После обновления кода сервер сам применит миграции `0002` и `0003`; старый `music.db` удалять не нужно, если он уже создан версией 0.8.

## Лимиты загрузки (v0.11)
Задаются в `backend/.env` (см. `.env.example`): `MAX_TRACK_SECONDS=3600` (трек до 1 часа), `MAX_TRACK_MB=2048` (потолок размера файла), `MAX_IMAGE_MB=20` (фото), `USER_QUOTA_GB=7` (все треки одного пользователя). Старая переменная `MAX_UPLOAD_MB` не используется — если она есть в вашем `.env`, замените её. Если перед приложением стоит nginx, поднимите `client_max_body_size` (например, до `2100m`).

## Структура
`backend/app/main.py` (API и модели), `backend/alembic/` (миграции), `backend/uploads/` (аудио, вне БД), `frontend/src/`.
Дизайн-система и витрина компонентов: `frontend/DESIGN.md`, страница `http://localhost:5173/#/ui`.
