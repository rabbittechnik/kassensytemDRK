# Abnahme vor der ersten Veranstaltung (Must-have)

Diese Liste dient der **vereinsinternen Kontrolle** vor dem ersten Einsatz der DLRG-Kasse. Abhaken, wenn der Punkt mit der geplanten Hardware und dem geplanten Modus (Offline/Online) getestet wurde.

## Gerät und Zugriff

- [ ] **Browser / PWA:** Installierte App oder unterstützter Browser (z. B. Chrome/Edge), idealerweise **HTTPS** (Voraussetzung für Web Bluetooth und PWA).
- [ ] **Anmeldung:** Admin-PIN bekannt und getestet; bei Online-Betrieb API-Anmeldung (Admin/Kasse) getestet.
- [ ] **Offline-Modus:** Katalog und Verkauf ohne Server erreichbar (falls vorgesehen).
- [ ] **Online-Modus:** Server erreichbar (`/health`), Katalog lädt, Verkauf bucht auf dem Server.

## Verkauf und Zahlarten

- [ ] **Warenkorb:** Artikel hinzufügen, Menge ändern, Gesamtsumme plausibel.
- [ ] **Barzahlung:** Abschluss, Wechselgeld / Kundenbon (falls genutzt).
- [ ] **Kartenzahlung:** Abschluss (ohne echtes Terminal, sofern nur als Zahlart erfasst).
- [ ] **Auf Rechnung:** Nur im vorgesehenen Kontext (aktive Veranstaltung, Team), Buchung prüfen.

## Druck und Bons

- [ ] **Bondrucker:** Web Bluetooth gekoppelt, Testdruck eines Verkaufsbons.
- [ ] **Pfand / Mehrfachbons:** Sofern genutzt, Stationsbons oder zweiter Bon wie vorgesehen.

## Tagesabschluss (Z-Bon)

- [ ] **Übersicht:** Verkäufe, Bar, Karte, **Auf Rechnung** und Summe für den Tag nachvollziehbar.
- [ ] **Z-Bon (lokal):** PDF-Übersicht und Bondruck ohne Server-Modus (Hinweis: kein zentraler Server-Abschluss).
- [ ] **Z-Bon (Online):** Mit Bestätigungsdialog; PDF-Download und Z-Bon-Druck; nach Abschluss keine Stornos mehr für diesen Tag (Server-Regel verstanden).

## Updates und Daten

- [ ] **PWA-Update:** Nach einem Deploy „Update“ ausführen; Version in der Kasse entspricht dem Release.
- [ ] **Backup:** Bei Online-Server klären, wer Datenbank-Backups prüft (Tagesabschluss legt serverseitig u. a. ein Backup an).

---

## Fiskalität und Rechtliches (Festlegung)

**Stand dieser Software:** Die Kasse ist für **Vereinsinterne Abrechnung und Kontrolle** ausgelegt. Im System-PDF zum Tagesabschluss ist ein Hinweis auf **Testsystem / keine Freigabe für steuerlich produktiven Echtbetrieb** verankert.

**Bewusste Abgrenzung:** Es handelt sich **nicht** um eine **TSE-/KassenSichV-konforme** Registrierkasse im Sinne der gesetzlichen Anforderungen für den allgemeinen steuerpflichtigen Einzelhandel. Ein **„fiskalischer Z-Bon“** im gesetzlichen Sinn erfordert zertifizierte Komponenten und fachliche Klärung (Steuerberater / Anwalt), **nicht** nur einen PDF- oder Bluetooth-Bon aus dieser Anwendung.

**Option „extern fiskal“:** Wenn der Verein für bestimmte Umsätze eine **gesonderte fiskalische Kasse** oder einen **Dienstleister** nutzt, muss klar sein, welche Umsätze wo gebucht werden, damit keine Doppel- oder Lückenbuchung entsteht.

**Empfehlung:** Vor dem Einsatz mit echtem Geldkreislauf kurz dokumentieren: *„Wir nutzen die DLRG-Kasse für … (z. B. interne Veranstaltungsabrechnung); fiskalische Pflichten erfüllen wir durch … (z. B. nicht zutreffend / externes System / nur interne Belege).“*

---

*Dokument kann bei Prozessänderungen angepasst werden. Technische Details siehe Quellcode und Server-API im Repository.*
