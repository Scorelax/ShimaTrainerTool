# Battle Map Display på Raspberry Pi — Løsningsskisse

Brief til Claude Code. Beskriver hvordan vi vil legge til en fysisk «bord-skjerm»
som viser battle maps / stemningsbilder under D&D-økter, drevet av den eksisterende
app-serveren som allerede kjører på en Raspberry Pi. Tilpass detaljene til det
faktiske stacket i repoet — dette dokumentet beskriver arkitektur og krav, ikke
språk/rammeverk.

## Mål og kontekst

- Appen er allerede server–klient: app-serveren kjører på en Raspberry Pi 4B,
  hver spiller har sin egen klient, og det finnes en combat-funksjon.
- Vi vil legge en 27" skjerm flatt i «vaulten» i spillbordet (avtakbare plater
  på toppen) som et felles display — finere enn å se alt på egne nettbrett/telefoner.
- Skjermen skal **ikke** bygges inn; den bare ligger i bordet og kobles til når vi spiller.
- Skjermen skal være en **passiv display-klient**. Den viser bare en nettside i appen.
  All styring skjer serverside gjennom appen — aldri ved å gjøre noe på selve Pi-en.

## Arkitektur (kjerneprinsipp)

- Bord-skjermen driftes av **samme Pi** som kjører serveren. Egen micro-HDMI → HDMI
  ut til skjermen. Ingen avhengighet til noen Mac.
- Pi-en kjører en **fullskjerms Chromium i kiosk-modus** pekt mot en dedikert
  visnings-rute i appen, f.eks. `http://localhost:<port>/display`.
- `/display` er **én enkelt, alltid-åpen side** som bytter **tilstand** basert på
  signaler fra serveren. Vi navigerer aldri til nye URL-er og laster aldri siden på nytt;
  bare innholdet inni endres. Dette gir sømløse overganger (ingen hvit blink, ingen
  re-init av Chromium, mulighet for kryssfade mellom bilder/video).

## Display-klienten (`/display`)

- Egen rute som **kun** inneholder den visuelle brett-visningen — ingen spillerkontroller.
  Da er det umulig å vise feil ting på bordet.
- Kobler til `localhost` / `127.0.0.1` → uavhengig av nettverk, momentan oppdatering.
- Lytter på appens state og rendrer gjeldende visningstilstand.

### Visningstilstander (utgangspunkt — utvid etter behov)

- `idle` — roterende stemningsbilder / stillbilder (en liten «spilleliste»).
- `map` — det battle-kartet DM har valgt for aktiv combat.
- `splash` — enkeltbilde, f.eks. boss-splash rett før kamp, bykart under utforskning, osv.

DM (eller appen) styrer hvilken tilstand som er aktiv — i praksis en liten
«hva vises på bordet nå»-kontroll i DM-verktøyet. Combat start → `map`.
Combat slutt → tilbake til `idle`.

### Tilstands-synkronisering

- Anbefalt: **websocket** (eller det realtids-mekanismet appen allerede bruker) slik at
  serveren dytter tilstandsendringer til `/display` umiddelbart.
- `/display` skal ha en fornuftig **default/fallback**: hvis serveren restarter eller
  kontakten glipper et øyeblikk, fall tilbake til et nøytralt `idle`-bilde —
  aldri en feilmelding eller «connection refused»-skjerm.

## Hardware

- Raspberry Pi 4B (helst 2–4 GB RAM; ~2 GB er praktisk minimum for Chromium).
- Pi-en ligger **bak TV-en** — ingen risiko for at noen drar strømmen ved uhell.
  Eneste realistiske strømbrudd er sikring/husstrøm.
- Micro-HDMI → HDMI-kabel til 27"-skjermen. **Bruk HDMI0** (porten nærmest USB-C-strøm)
  pga. en kjent kiosk-quirk der Chromium ellers kan starte på «feil» HDMI-port.
- **Kjøling er viktig:** plassen bak en TV er ofte innelukket og varm, og Pi-en kjører
  server + video-dekoding samtidig. Bruk offisiell 5V/3A-forsyning + heatsink, helst en
  liten vifte. Underdimensjonert strøm/varme → undervoltage-throttling som arter seg
  som tilfeldig hakking (kjipt å feilsøke i ettertid).
- Vurder **boot fra USB/SSD** i stedet for SD-kort som billig forsikring mot korrupsjon
  ved sikring/strømbrudd. Legg uansett browser-cache i RAM (se under).

## Raspberry Pi OS-oppsett

- **Raspberry Pi OS Lite** + en minimal Wayland-kompositor som *kun* noensinne starter
  kiosken. Grunn: når kiosken drepes mellom øktene skal skjermen bli **svart**, ikke
  avsløre et skrivebord. Med full desktop-utgave vil et drept nettleservindu vise
  skrivebordet — nettopp det «andre Pi-UI-et» vi vil unngå.
- Bookworm bruker **Wayland/labwc**, ikke det gamle X11-oppsettet. Kiosk startes med noe
  i retning av:
  `chromium --kiosk --ozone-platform=wayland http://localhost:<port>/display`
  med flagg for å undertrykke prompts (se robusthet under).
- **Skru av screen blanking på Wayland-riktig måte** (f.eks. wlopm / labwc-konfig).
  De gamle `xset`-triksene virker ikke under Wayland — uten dette svartner bordet midt
  i en lang scene uten input.

## Livssyklus (start/stopp on-demand)

Kiosken skal **ikke** kjøre 24/7. Serveren styrer den basert på aktivitet:

- **Start** kiosken når en spiller kobler seg til (det er ingen grunn til at Chromium
  kjører når ingen bruker appen).
- **Stopp** kiosken når ingen er tilkoblet.
- **Timer:** kast ut spillere som har vært aktive i mer enn ~24t, slik at «ingen tilkoblet»
  faktisk inntreffer og ryddes opp.

Denne modellen har to gratis fordeler:
- **Boot race forsvinner:** siden serveren starter displayet (fordi noen koblet til),
  er serveren per definisjon oppe når Chromium startes — `/display` kan aldri laste før
  serveren svarer.
- **Staleness/minnelekkasje over dager forsvinner:** frisk Chromium-prosess hver økt.

### Viktig implementasjonsdetalj: hvordan starte GUI-en on-demand

- Å la server-bakgrunnsprosessen bare `fork/exec`-e `chromium` feiler typisk med
  «cannot connect to compositor», fordi bakgrunnsprosessen mangler sesjons-miljøet
  (`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, riktig bruker).
- **Riktig mønster:** pakk kiosken som en **systemd user-service** i den grafiske
  sesjonen, og la serveren bare skru den av/på:
  `systemctl --user start kiosk` / `systemctl --user stop kiosk`.
  Da arver Chromium riktig miljø hver gang.
- Konsekvens (akseptert): bord-skjermen er **svart når ingen spiller**. Stemningsbildene
  vises altså *under* en økt, ikke som 24/7-ambient. Helt greit — TV-en er av uansett.

## Video

- Assets lages som **PNG → loopende MP4 (H.264)** for å gi «dynamiske» karakterbilder.
  H.264 dekodes i hardware på Pi 4B, så 1080p med noen animerte tokens går fint.
- Video **må** settes `muted` + `playsinline`, ellers blokkerer Chromium autoplay og du
  får et frosset førstebilde.
- Pi 4 har begrenset samtidig hardware-dekoding: én til noen få loopende 1080p-klipp er ok,
  men ikke la mange tunge videoer dekode i bakgrunnen samtidig. **Pause/skjul** videoer som
  ikke vises akkurat nå.
- Unngå tunge 1440p-videomengder på samme boks som serveren; hvis det blir aktuelt, flytt
  displayet til en egen liten kiosk-boks og la Pi-en være ren server.

## Robusthetskrav (må håndteres i kode)

- [ ] `/display` **retry-er tilkoblingen** i loop med backoff til serveren svarer
      (selvhelbredende uansett oppstartsrekkefølge).
- [ ] `/display` faller tilbake til nøytralt `idle`-bilde ved tap av kontakt — aldri feilmelding.
- [ ] Ved **hvert tilstandsbytte**: riv ned det gamle før du bygger nytt — pause og fjern
      `<video>`-elementer, av-registrer event-listeners, slipp dekoder-kontekster.
      (Selv med daglig frisk prosess akkumulerer lekkasjer over en lang spillkveld.)
- [ ] Video `muted` + `playsinline`.
- [ ] Chromium-flagg for ren kiosk: undertrykk crash-restore-boblen
      (`--disable-session-crashed-bubble`), infobars, first-run, oppdaterings-/tillatelses-prompts;
      legg cache i RAM (`--disk-cache-dir=/dev/null`).
- [ ] Screen blanking av (Wayland-riktig, ikke `xset`).
- [ ] Kiosk som systemd user-service; server styrer via `systemctl --user start/stop`.
- [ ] Start kiosk ved første tilkobling, stopp når ingen er tilkoblet; 24t inaktivitets-timeout.

## Åpne beslutninger (avklares ved implementasjon)

- Realtidskanal for tilstand: websocket vs. eksisterende mekanisme i appen.
- Hvor idle-«spillelisten» og tilgjengelige kart/splash-bilder konfigureres (DM-verktøyet).
- Nøyaktig valg av minimal Wayland-kompositor / kiosk-oppsett på Pi OS Lite.
- SD vs. USB/SSD-boot.
