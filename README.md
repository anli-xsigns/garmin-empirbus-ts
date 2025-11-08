Garmin EmpirBus TypeScript (Clean Architecture)

Quickstart:
1) cd garmin-empirbus-ts
2) npm i
3) npm run build
4) EMPIRBUS_WS=ws://192.168.1.1:8888/ws npm run start

CLI prints channels and streams updates. Toggle and dim methods are available via repository for later command extensions.

### wslog (Viewer)
- Live von WebSocket lesen **oder** bestehende Logdatei wie `tail -f` verfolgen.
- Filterbar nach Richtung (in/out) und Text.
- Optionales Mitschreiben in Datei.

Beispiele:
```
# Live ansehen
node dist/bin/wslog.js --ws ws://192.168.1.1:8888/ws

# Live ansehen und gleichzeitig mitschreiben
node dist/bin/wslog.js --ws ws://192.168.1.1:8888/ws --log traffic.ndjson

# Nur Datei ansehen (tail -f)
node dist/bin/wslog.js --file traffic.ndjson
```

Tasten: F=Filter, I=In, O=Out, A=All, C=Clear, S=Save, Q=Quit

### wstap (reiner Mitschreiber ohne UI)
```
node dist/bin/wstap.js --log traffic.ndjson --ws ws://192.168.1.1:8888/ws
```
