# Cuttie pour Windows

L'app desktop : une coque Electron légère autour de ce qui tourne déjà avec `npm start` (l'API compilée qui sert le front + le worker Python), plus l'installation des modules d'analyse au premier lancement et les mises à jour en un clic.

## Installer (pour le streamer)

1. Télécharger `Cuttie-Setup-x.y.z.exe` sur la page [Releases](https://github.com/cgobbo8/cuttie/releases/latest) et le lancer.
2. Windows affiche « Windows a protégé votre ordinateur » (l'app n'est pas signée) : **Informations complémentaires** → **Exécuter quand même**. Ça n'arrive qu'à l'installation, pas aux mises à jour.
3. Premier lancement : Cuttie installe ses modules d'analyse (PyTorch avec CUDA, Whisper…). Une seule fois, 5 à 15 min selon la connexion, environ 5 Go.
4. Puis l'accueil : la chaîne Twitch, la clé OpenRouter, la webcam.

**Mises à jour** : une pastille « Mise à jour » apparaît en haut quand une version sort ; Paramètres → Application → **Mettre à jour**, puis **Redémarrer pour installer**. Les projets et réglages restent.

**En cas de souci** :
- Paramètres → Diagnostic → **Tester (30 s)** (GPU + Whisper sur ce PC), puis **Copier le rapport** et l'envoyer.
- Paramètres → Application → **Ouvrir les journaux** (`cuttie.log`), ou **Réparer les modules d'analyse** (réinstalle les modules Python depuis le cache, quelques minutes).

Où sont les choses :

| Quoi | Où |
|---|---|
| L'app | `%LOCALAPPDATA%\Programs\cuttie` |
| Projets, clips, réglages, journaux | `%LOCALAPPDATA%\Cuttie\data` |
| Python et ses modules | `%LOCALAPPDATA%\Cuttie\python-env` (+ `python`) |
| Cache des téléchargements Python | `%LOCALAPPDATA%\uv\cache` |

Désinstaller (Paramètres Windows → Applications) garde les données ; supprimer `%LOCALAPPDATA%\Cuttie` efface tout.

## Comment ça marche

- `main.mjs` : écran de démarrage (`setup.html`), installation de Python, puis `scripts/launcher.mjs` (API + worker sur 127.0.0.1) dans une fenêtre. Si l'API ou le worker s'arrête, une boîte propose de redémarrer.
- **Python n'est pas embarqué** : `uv` (embarqué) installe Python 3.12 et les modules de `backend/uv.lock` au premier lancement, dans `%LOCALAPPDATA%\Cuttie`. Un hash de `uv.lock` est gardé : une mise à jour qui change les dépendances relance un `uv sync` (seuls les modules changés se téléchargent).
- Embarqués dans `resources/bin` : `node.exe` (le même que celui du build, pour `better-sqlite3`), `uv.exe`, `ffmpeg.exe` / `ffprobe.exe` (build « essentials » de Gyan, version et sha256 fixés dans `scripts/stage.mjs`). Le navigateur de rendu de Remotion est téléchargé au build.
- **Mises à jour** : `electron-updater` lit `latest.yml` sur la dernière release GitHub, télécharge l'installeur (en différentiel grâce au `.blockmap`), arrête l'API et le worker, installe en silence et relance Cuttie.
- `preload.cjs` expose `window.cuttieDesktop` aux pages (version, mises à jour, journaux, réparation) ; le front l'utilise dans `src/lib/desktop.ts` (absent dans un navigateur).

## Développer

```bash
npm install                 # ici, dans desktop/
npm run dev                 # Electron sur le dépôt (api/build et frontend/dist : `npm start` à la racine les construit)
npm run pack                # app empaquetée pour cet OS, sans installeur (Mac : dist/mac-arm64/Cuttie.app)
npm run dist                # installeur Windows (sur Windows)
```

`scripts/stage.mjs` prépare `stage/` (ce que l'installeur embarque) : il construit le front et l'API, installe les modules de prod de l'API, copie les sources du worker et les outils. À lancer sur l'OS visé (les `node_modules` dépendent de la plateforme).

## Tester ce qui tournera chez lui

1. **CI Windows** (`.github/workflows/desktop.yml`, `windows-latest`, gratuit pour un dépôt public) à chaque push sur `feat/local-desktop` : construit l'installeur, l'installe en silence, lance `Cuttie.exe --smoke-test=full` (modules Python avec PyTorch CUDA, API, worker, ffmpeg, yt-dlp, Whisper sur le CPU : la machine n'a pas de GPU) et passe les tests front / API / worker sous Windows. L'installeur, `smoke-report.json` et `cuttie.log` sont dans les artefacts du run.
2. **Un PC ou une VM Windows** : `powershell -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Full -Installer .\Cuttie-Setup-x.y.z.exe`.
3. **Le GPU NVIDIA** ne se teste que sur une vraie carte (son PC, ou une VM GPU louée) : Paramètres → Diagnostic → **Tester (30 s)** donne CUDA, cuDNN, la VRAM et la vitesse de Whisper, ou l'erreur exacte, dans le rapport copié.
4. **Sur le Mac** : `npm run pack`, puis `dist/mac-arm64/Cuttie.app/Contents/MacOS/Cuttie --smoke-test --smoke-report=report.json`.
5. **Un PC Windows à distance** (fait sur un portable GTX 1650 Max-Q) : serveur OpenSSH activé, clé du Mac autorisée, puis depuis le Mac :
   - installer en silence (`Cuttie-Setup-x.y.z.exe /S`), lancer `Cuttie.exe --smoke-test=full`, lire `%LOCALAPPDATA%\Cuttie\data\logs\cuttie.log` ;
   - `Cuttie.exe --update-test=<rapport.json>` : ce que fait le bouton de mise à jour (vérification, téléchargement, installation silencieuse), sans fenêtre ;
   - lancer l'app dans la session de l'utilisateur (tâche planifiée « interactive ») avec `--remote-debugging-port=9333`, tunnel SSH vers ce port, et la piloter avec Playwright (`connectOverCDP`) : captures, clics sur les vrais boutons.

Ce qu'un Windows neuf a appris (et que la CI ne voit pas, ses machines ayant Visual Studio) : pas de runtime Visual C++ (PyTorch et numba en ont besoin : DLL embarquées dans `resources/bin/msvc`, ajoutées au chemin des DLL du worker par `CUTTIE_DLL_DIRS`) ; un magasin de certificats rempli à la demande (le worker pointe `SSL_CERT_FILE` vers certifi).

## Publier une version

1. Monter `version` dans `desktop/package.json` (ex. `0.1.1`) et écrire les nouveautés dans `release-notes.md` (affichées dans l'app avant la mise à jour).
2. Commit, puis `git tag v0.1.1` et `git push origin v0.1.1`.
3. La CI construit, teste, puis publie la release : les apps installées la proposent.
