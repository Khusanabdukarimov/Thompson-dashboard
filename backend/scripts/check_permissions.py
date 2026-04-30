
import requests

config_token = "EAAoJwDMzIzsBRQi4BuZA6SZAiAJZAyosaJXr9ZChDv9kJgF2JTJpEQ49rEl5zYsvL4Q0WQmwvcTDsHm7QL4h8j968GLeqyPy2N0fEnjmErv8LD0EkZAcEBYKt51twHHw0maamZC1JNspUTYnSIhaUwZCb5Ou6KGE7LuHHHPXFbb95MEm3ENu9yaY6vfnC8HKY0qA2duG3l5beog"

res = requests.get(
    f"https://graph.facebook.com/v19.0/me/permissions",
    params={"access_token": config_token}
)
print(res.json())
