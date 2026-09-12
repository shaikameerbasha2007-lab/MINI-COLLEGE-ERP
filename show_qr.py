import requests
import qrcode
import time
import os
import subprocess
import webbrowser

def get_ngrok_url():
    try:
        r = requests.get("http://127.0.0.1:4040/api/tunnels")
        tunnels = r.json()['tunnels']
        for tunnel in tunnels:
            if tunnel['proto'] == 'https':
                return tunnel['public_url']
    except:
        return None

while True:
    url = get_ngrok_url()
    if url:
        print("Ngrok URL:", url)
        img_path = os.path.join(os.getcwd(), "ngrok_qr.png")
        img = qrcode.make(url)
        img.save(img_path)

        subprocess.Popen(['mspaint', img_path])
        webbrowser.open(url)
        break
    else:
        print("Waiting for ngrok to start...")
        time.sleep(2)
