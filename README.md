# NeuroRegen Tracker — Flask app

Live web dashboard version of the `neuroregen-tracker` notebook, built for deployment on a personal VPS/domain.

## Run locally

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Visit `http://localhost:5000`.

## Deploy on a VPS (gunicorn + nginx)

```bash
pip install -r requirements.txt
gunicorn -w 2 -b 127.0.0.1:8000 app:app
```

Then reverse-proxy `8000` behind nginx/your domain with TLS (certbot). Two workers is plenty — this app is I/O-bound (waiting on the ClinicalTrials.gov API), not CPU-bound, and results are cached in-process for 6 hours per (condition, keyword) query, so gunicorn workers each hold their own small cache.

## Notes

- `app.py` fixes a bug present in the original notebook: ClinicalTrials.gov API v2 nests the trial start date under `statusModule.startDateStruct.date`, not `statusModule.startDate`. The notebook read the wrong key, which silently zeroed out every "Start Year" — verified against a live 84-study pull (0/84 populated before the fix, 82/84 after).
