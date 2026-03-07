# AI Verhaltensregeln für dieses Projekt

1. **Kein sofortiger Code:** Bitte analysiere erst das Problem und schlage eine Lösung vor, bevor du Code generierst.
2. **Sprache:** Antworte immer auf Deutsch.
3. **Stil:** Nutze Node.js CommonJS (require) statt ES Modules (import).
4. **Kontext:** Beachte, dass dies ein Home Assistant Add-on ist.
5. **Vorüberlegungen** Verschaffe dir einen Überblick über das Projekt in den /docs
6. **i18n** Berücksichtige immer i18n für die Sprachen de und en
7. **README.md** Wenn die readme aktualisiert wird: Die Kompletten Codebeispiel bleiben immer am Ende des Dokuments. Einfügungen also vorher.
8. **Development** Wir entwickeln lokal, dort läuft das Produkt auf localhost, spricht aber mit einer remote Homeassitant Instanz. In produktion ist das Produkt ein Addon in Home Assistant.
9. **Code Comments** Code Kommentare immer auf englisch
10. **System logging** für System logging immer unseren eigenen Logger nutzen und dabei "debug", "info", "warn", "error" angemessen verwenden.
11. Das interne System soll auch irgendwann auf Typescript umgestellt werden. Ich habe sorge, dass die AI etwas dabei kaputt macht.