from flask import Flask, request, jsonify
from flask_cors import CORS
import requests, base64, datetime, os
from waitress import serve

app = Flask(__name__)
CORS(app)

CONSUMER_KEY = os.getenv("DARAJA_CONSUMER_KEY", "YOUR_KEY")
CONSUMER_SECRET = os.getenv("DARAJA_CONSUMER_SECRET", "YOUR_SECRET")
SHORTCODE = os.getenv("DARAJA_SHORTCODE", "174379")
PASSKEY = os.getenv("DARAJA_PASSKEY", "YOUR_PASSKEY")

def get_token():
    key = base64.b64encode(f"{CONSUMER_KEY}:{CONSUMER_SECRET}".encode()).decode()
    r = requests.get(
        "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        headers={"Authorization": f"Basic {key}"}
    )
    return r.json()["access_token"]

@app.route("/api/mpesa/withdraw", methods=["POST"])
def withdraw():
    data = request.json
    phone = data.get("phone")
    amount = data.get("amount")
    token = get_token()
    timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(f"{SHORTCODE}{PASSKEY}{timestamp}".encode()).decode()
    payload = {
        "BusinessShortCode": SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": amount,
        "PartyA": phone,
        "PartyB": SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": "https://your-domain.com/api/mpesa/callback",
        "AccountReference": "EverReach Withdraw",
        "TransactionDesc": "EverReach Withdrawal"
    }
    r = requests.post(
        "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        json=payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    return jsonify({"message": "STK Push sent", "daraja": r.json()})

if __name__ == "__main__":
    print("Serving on http://127.0.0.1:5000 - No warning")
    serve(app, host="127.0.0.1", port=5000)
