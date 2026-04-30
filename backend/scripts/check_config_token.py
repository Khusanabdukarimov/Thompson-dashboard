
import requests
import os
from dotenv import load_dotenv

# config.js dagi tokenni tekshiramiz
config_token = "EAAoJwDMzIzsBRewA5BQZBpoZAi3UwlZBGzW9CGLg98IGSJZBGzxIrtDyxDbkyMqF7qnSJabUsd0QVKUeVoGysdPzOeNgZConHujUc5bZCEKjZBGIIBken7VlX8BOBawECvklxQD7H97znn9QbDxOKgZC438YZAZCQoZAFojW46M99txlpPYtZA9bPjZAOiE2L96Yd7sv5aPAf1JuKzfx2G7RjJgrNLoNlZAOAqh0yk0XurkkOdmouXZCZCJ3PCP24l2ZCmSUMu5x20fjLO8r3qGVp4ZAeLCAdpZAXs0PSBlcZBvCgZAr8lgZDZD"

res = requests.get(
    f"https://graph.facebook.com/v19.0/me",
    params={"access_token": config_token}
)
print(res.json())
