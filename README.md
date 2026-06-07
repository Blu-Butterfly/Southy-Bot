# SouthyBot Deployment Package

This folder contains the Southwestern University frontend, SouthyBot chat UI, login API, and deployable backend.

## Run Locally

```powershell
python .\server.py
```

Open:

```text
http://127.0.0.1:4173/
```

Local mode automatically reads the Access database when it is available:

```text
C:\Users\Esther Oladega\Documents\SouthyBot KnowledgeBase.accdb
```

## Cloud Deployment

Cloud hosts usually cannot read Microsoft Access files, so this package includes `knowledge-base.json` with the exported bot data.

Use these settings on a Python web service host:

```text
Build command: pip install -r requirements.txt
Start command: python server.py
Environment variable: SOUTHYBOT_KB_SOURCE=json
```

The server also supports the standard cloud `PORT` environment variable.

## Included Deployment Files

- `index.html` - main website page
- `login.html` - login page
- `styles.css` - website styling
- `script.js` - SouthyBot and login frontend logic
- `server.py` - Python web server and API
- `knowledge-base.json` - deployable SouthyBot data export
- `auth-users.json` - demo login users
- `Procfile` - process file for Heroku-style hosts
- `render.yaml` - Render blueprint
- `requirements.txt` - Python dependency file

## Demo Login Accounts

```text
Student: student / student123
Applicant: applicant / applicant123
Staff: staff / staff123
```
