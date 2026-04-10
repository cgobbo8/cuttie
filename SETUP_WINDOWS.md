# Installer Cuttie sur Windows (RTX 4070 Super)

Guide pas-a-pas pour installer et lancer Cuttie sur un PC Windows avec GPU NVIDIA.
A la fin, un raccourci **Cuttie.bat** sur le Bureau lance tout en un double-clic.

---

## Pre-requis

- **Windows 10** (21H2+) ou **Windows 11**
- **GPU NVIDIA** avec drivers a jour (le PC gaming a deja les drivers)
- **~20 Go** d'espace disque libre (Python ML libs + modeles)
- **16 Go de RAM** minimum recommandes (les modeles ML en utilisent ~4-5 Go)
- Une connexion internet (pour telecharger les dependances et les modeles au premier lancement)

---

## Etape 1 — Installer WSL2

WSL2 permet de faire tourner Linux dans Windows. C'est la qu'on execute Cuttie.

### 1.1 Ouvrir PowerShell en administrateur

- Clic droit sur le menu Demarrer (ou `Win + X`)
- Choisir **"Terminal (administrateur)"** ou **"PowerShell (administrateur)"**

### 1.2 Installer WSL + Ubuntu

Copier-coller cette commande et appuyer sur Entree :

```powershell
wsl --install -d Ubuntu-24.04
```

Ca va telecharger et installer Ubuntu. **Redemarrer le PC** quand demande.

### 1.3 Configurer Ubuntu

Apres le redemarrage, une fenetre Ubuntu s'ouvre automatiquement.
Elle demande de creer un compte :

```
Enter new UNIX username: cuttie
New password: ********
Retype password: ********
```

Le nom et le mot de passe sont au choix (c'est local a WSL, pas le compte Windows).

> **Si la fenetre ne s'ouvre pas** : ouvrir le menu Demarrer, chercher "Ubuntu" et le lancer.

---

## Etape 2 — Verifier le GPU

Toujours dans le terminal Ubuntu, taper :

```bash
nvidia-smi
```

Ca doit afficher quelque chose comme :

```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 555.xx    Driver Version: 555.xx    CUDA Version: 12.x          |
|   GPU Name           ...           | Memory  12GB                          |
|   NVIDIA GeForce RTX 4070 SUPER    |                                      |
+-----------------------------------------------------------------------------+
```

**Si `nvidia-smi` ne marche pas** :
1. Verifier que les drivers NVIDIA sont a jour sur Windows
   - Ouvrir **GeForce Experience** > Drivers > Telecharger
   - Ou aller sur https://www.nvidia.fr/drivers/ et installer le dernier driver
2. Redemarrer le PC
3. Reouvrir Ubuntu et retenter `nvidia-smi`

> Les drivers Windows se partagent automatiquement avec WSL2.
> PAS besoin d'installer CUDA dans Ubuntu, les drivers Windows suffisent.

---

## Etape 3 — Installer Git dans WSL (si pas deja fait)

```bash
sudo apt-get update && sudo apt-get install -y git
```

Configurer git avec ton identite (optionnel mais pratique) :

```bash
git config --global user.name "Ton Nom"
git config --global user.email "ton@email.com"
```

---

## Etape 4 — Cloner le projet

```bash
git clone https://github.com/TON_USER/cuttie.git ~/cuttie
```

> Remplacer `TON_USER` par le vrai chemin du repo.
> Si le repo est prive, il faudra d'abord configurer un token GitHub :
>
> ```bash
> git clone https://TOKEN@github.com/TON_USER/cuttie.git ~/cuttie
> ```

---

## Etape 5 — Lancer l'installation

```bash
cd ~/cuttie
bash scripts/install-wsl.sh
```

Le script fait tout automatiquement :

| Etape | Ce qu'il installe |
|-------|-------------------|
| 1/7 | ffmpeg, redis, curl, git |
| 2/7 | Node.js 22 |
| 3/7 | uv (gestionnaire Python) |
| 4/7 | Minio (stockage S3 local) |
| 5/7 | Dependances Node (api + frontend) |
| 6/7 | Dependances Python (torch, pyannote, etc.) — **peut prendre 5-10 min** |
| 7/7 | Fichiers .env + migrations DB + raccourci Bureau |

A la fin il affiche :

```
  GPU: NVIDIA GeForce RTX 4070 SUPER, 12288 MiB

  ---------------------
  Installation complete!

  NEXT STEP: add your API keys in
    /home/cuttie/cuttie/backend/.env
  ---------------------
```

> **Si l'etape 6 est tres longue** c'est normal : PyTorch + les modeles ML font
> plusieurs Go a telecharger la premiere fois.

---

## Etape 6 — Configurer les cles API

Ouvrir le fichier de configuration du backend :

```bash
nano ~/cuttie/backend/.env
```

Remplir les cles API necessaires :

```env
GROQ_API_KEY=gsk_...          # Pour la transcription Whisper
OPENROUTER_API_KEY=sk-or-...  # Pour l'analyse LLM (Gemini)
```

> **Comment obtenir les cles :**
> - **Groq** : https://console.groq.com/keys (gratuit, compte Google)
> - **OpenRouter** : https://openrouter.ai/keys (payer au token)

Sauvegarder : `Ctrl+O` puis `Entree`, puis `Ctrl+X` pour quitter nano.

Le fichier `api/.env` est deja configure automatiquement (APP_KEY genere, Redis/Minio en localhost).

---

## Etape 7 — Premier lancement

Double-cliquer sur **Cuttie.bat** sur le Bureau Windows.

Une fenetre terminal s'ouvre et affiche :

```
  Cuttie
  ------

  Redis:    started
  Minio:    started
  GPU:      NVIDIA GeForce RTX 4070 SUPER

  http://localhost:5173
```

Le navigateur s'ouvre automatiquement sur l'app.
Les trois services tournent (API, Worker, Frontend) avec des logs colores.

> **Au tout premier lancement** le worker telecharge les modeles ML
> (pyannote, PANNs, Whisper). Ca peut prendre quelques minutes.
> Les lancements suivants sont instantanes (modeles en cache).

---

## Utilisation au quotidien

### Lancer

Double-clic sur **Cuttie.bat** sur le Bureau. C'est tout.

### Arreter

Fermer la fenetre du terminal, ou faire `Ctrl+C` dedans.
Redis et Minio s'arretent proprement automatiquement.

### Mettre a jour

Il n'y a **rien a faire**. A chaque lancement, le script :
1. Fait un `git pull` automatique
2. Si les dependances ont change, les reinstalle
3. Lance les migrations de base de donnees

Tu push ton code, ton pote double-clic — il a la derniere version.

---

## Depannage

### "wsl n'est pas reconnu comme commande"

WSL n'est pas installe. Reouvrir PowerShell en admin et lancer :
```powershell
wsl --install -d Ubuntu-24.04
```

### "nvidia-smi : command not found"

Les drivers NVIDIA ne sont pas installes ou pas a jour.
1. Sur **Windows** (pas dans Ubuntu), installer les derniers drivers depuis https://www.nvidia.fr/drivers/
2. Redemarrer le PC

> Ne PAS installer de drivers NVIDIA dans Ubuntu/WSL. C'est le driver Windows qui est partage.

### Le terminal se ferme immediatement

Ouvrir Ubuntu manuellement (menu Demarrer > Ubuntu) et lancer :
```bash
cd ~/cuttie && bash scripts/start.sh
```
Pour voir le message d'erreur.

### "address already in use" (port occupe)

Un service d'un lancement precedent tourne encore. Tout arreter :
```bash
redis-cli shutdown nosave 2>/dev/null
pkill -f "minio server" 2>/dev/null
pkill -f "node ace" 2>/dev/null
pkill -f "worker.py" 2>/dev/null
pkill -f "vite" 2>/dev/null
```
Puis relancer Cuttie.bat.

### "ENOMEM" ou "Killed" (plus de memoire)

Le PC n'a pas assez de RAM. Fermer les jeux / applis lourdes avant de lancer Cuttie.
Avec 16 Go de RAM ca passe, 8 Go c'est trop juste.

Pour augmenter la memoire WSL, creer le fichier `C:\Users\TON_USER\.wslconfig` :
```ini
[wsl2]
memory=12GB
```
Puis redemarrer WSL : `wsl --shutdown` dans PowerShell.

### Les modeles ML sont re-telecharges a chaque fois

Le cache HuggingFace est dans `~/.cache/huggingface/`. S'assurer qu'il n'est pas supprime entre les lancements. C'est le cas par defaut.

### git pull echoue ("divergent branches")

Des fichiers locaux ont ete modifies par erreur. Remettre a zero :
```bash
cd ~/cuttie && git checkout . && git pull
```

---

## Architecture (pour info)

```
Double-clic Cuttie.bat
  |
  +-- wsl -e bash start.sh
        |
        +-- git pull (mise a jour auto)
        +-- Redis (queue de jobs)
        +-- Minio (stockage clips S3)
        +-- AdonisJS API (port 3333)
        +-- Python Worker (GPU, analyse VODs)
        +-- Vite Frontend (port 5173) --> navigateur
```

Tout tourne en local sur la machine. Rien n'est envoye a un serveur externe
sauf les appels aux APIs LLM (Groq pour Whisper, OpenRouter pour Gemini).

---

## Desinstaller

Si besoin de tout supprimer :

```bash
# Dans Ubuntu
rm -rf ~/cuttie ~/cuttie-data ~/.local/bin/minio ~/.local/bin/mc
```

```powershell
# Dans PowerShell (supprimer WSL entierement)
wsl --unregister Ubuntu-24.04
```

Supprimer `Cuttie.bat` du Bureau.
