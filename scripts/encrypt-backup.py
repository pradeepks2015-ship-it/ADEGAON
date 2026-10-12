# बैकअप की Excel फ़ाइलों पर पासवर्ड लगाता है (Excel का अपना AES-256 ताला)।
# repo public है — GitHub पर बना artifact कोई भी logged-in व्यक्ति उतार सकता है, इसलिए उसमें
# उपभोक्ताओं के नाम/मोबाइल/पते सादे रूप में कभी नहीं जाने चाहिए (12/10/2026 को पकड़ा गया)।
# पासवर्ड GitHub Secret BACKUP_PASSWORD से आता है (JE का login वाला पासवर्ड — JE का फ़ैसला 12/10)।
# पासवर्ड न हो या ताला लगाने में कुछ भी गड़बड़ हो तो सादी फ़ाइलें मिटाकर फेल — बिना ताले की
# फ़ाइल artifact तक कभी न पहुंचे।
# इस्तेमाल: BACKUP_PASSWORD=... python3 scripts/encrypt-backup.py backup-output
import glob
import os
import sys

from msoffcrypto.format.ooxml import OOXMLFile


def wipe(files):
    for f in files:
        try:
            os.remove(f)
        except OSError:
            pass


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "backup-output"
    plain = sorted(glob.glob(os.path.join(folder, "*.xlsx")))
    pw = os.environ.get("BACKUP_PASSWORD", "")
    if not pw:
        wipe(plain)
        print("❌ BACKUP_PASSWORD secret नहीं मिला — बिना ताले का बैकअप नहीं रखेंगे", file=sys.stderr)
        sys.exit(1)
    if not plain:
        print("❌ कोई .xlsx बैकअप फ़ाइल नहीं मिली", file=sys.stderr)
        sys.exit(1)
    try:
        for src in plain:
            dst = src + ".locked"
            with open(src, "rb") as f, open(dst, "wb") as out:
                OOXMLFile(f).encrypt(pw, out)
            # जांच: बनी फ़ाइल सचमुच तालाबंद हो
            with open(dst, "rb") as f:
                if not OOXMLFile(f).is_encrypted():
                    raise RuntimeError("ताला नहीं लगा: " + src)
            os.replace(dst, src)  # उसी नाम पर अब सिर्फ़ तालाबंद फ़ाइल
            print("🔒 " + os.path.basename(src))
    except Exception as e:  # noqa: BLE001 — कुछ भी हो, सादी फ़ाइल न बचे
        wipe(plain + glob.glob(os.path.join(folder, "*.locked")))
        print("❌ ताला लगाने में गड़बड़: " + str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
