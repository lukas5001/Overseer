"""Nur intern verwenden — generiert signierte Lizenz-Keys."""
import hashlib
import hmac
import json
import base64
import sys

SECRET = "overseer_license_signing_secret_never_expose"  # Intern, nicht im Repo


def generate(customer: str, expires: str, max_hosts: int) -> str:
    payload = {"customer": customer, "expires": expires, "max_hosts": max_hosts}
    data = json.dumps(payload, sort_keys=True).encode()
    sig = hmac.new(SECRET.encode(), data, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(data + b"." + sig).decode()


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python generate_license.py <customer> <expires YYYY-MM-DD> <max_hosts>")
        sys.exit(1)
    print(generate(sys.argv[1], sys.argv[2], int(sys.argv[3])))
