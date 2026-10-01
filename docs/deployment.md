# Déployer ProceduralPlanets sur le VPS

Le workflow `.github/workflows/deploy.yml` teste le front et l'API, construit
le front sur GitHub, transfère les fichiers par SSH/rsync, installe les
dépendances de l'API, applique les migrations et redémarre les deux processus
PM2. Il vérifie ensuite les réponses HTTP du front et de l'API (base incluse).

Les pull requests lancent uniquement les vérifications. Un push sur `main`
déploie automatiquement. Le bouton **Actions → CI and deploy Procedural Planets
→ Run workflow**, en sélectionnant `main`, permet un lancement manuel.
La branche `develop` ne déploie pas.

```text
/home/ProceduralPlanets/
├── web/                 front construit, port 7071
├── api/                 backend, port 7070
│   └── .env             secrets conservés sur le VPS
└── deploy-vps.sh

https://procedural-planets.com      → Pangolin → VPS:7071
https://api.procedural-planets.com  → Pangolin → VPS:7070
```

## 1. Préparer le VPS une seule fois

Cette configuration suppose un VPS Linux avec Node.js ≥ 22, npm, PM2,
MySQL 8+ ou MariaDB 10.6+, rsync, curl et flock. Le routage des domaines et
HTTPS sont gérés séparément dans Pangolin. Réutiliser les installations existantes.
Exécuter les commandes PM2 sous le compte **deploy**, celui utilisé par GitHub.
Vérifier aussi que les commandes Node/npm/PM2 sont accessibles dans une session
SSH non interactive ; une installation NVM peut nécessiter une configuration
supplémentaire du PATH.

Depuis une session administrateur, créer un dossier réservé à Planets :

```sh
sudo install -d -o deploy -g deploy -m 750 /home/ProceduralPlanets
sudo -iu deploy
mkdir -p /home/ProceduralPlanets/api
command -v node npm pm2 rsync curl flock
node --version
ss -ltn | grep -E ':7070|:7071' || true
```

Les ports 7070 et 7071 doivent être libres pour le premier lancement. Les
processus seront nommés `procedural-planets-web` et `procedural-planets-api`.
Si l'ancien workflow Planets a déjà lancé `PlanetStudio` / `PlanetStudioApi`,
prévoir leur arrêt lors du basculement après avoir vérifié leur identité avec
`pm2 describe`. Aucun processus Procedural Terrains ne doit être arrêté.

Depuis la console administrateur MySQL/MariaDB, créer une base et un utilisateur
propres à Planets. Remplacer le mot de passe avant exécution :

```sql
CREATE DATABASE procedural_planets
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'planet'@'127.0.0.1' IDENTIFIED BY 'REMPLACER_PAR_UN_MOT_DE_PASSE_LONG';
GRANT ALL PRIVILEGES ON procedural_planets.* TO 'planet'@'127.0.0.1';
```

Créer `/home/ProceduralPlanets/api/.env` en recopiant
[`deploy/api.env.example`](../deploy/api.env.example). Remplacer `DB_PASSWORD`,
`ADMIN_EMAILS` par ton adresse et `PRIVACY_HASH_SECRET` par une valeur générée
avec `openssl rand -hex 32`. Garder `COOKIE_DOMAIN` vide : le cookie reste
attaché au domaine API ; le front et l'API sont sous le même domaine parent.

```sh
nano /home/ProceduralPlanets/api/.env
chmod 600 /home/ProceduralPlanets/api/.env
```

Ce fichier doit appartenir à `deploy`. Le workflow le préserve à chaque mise
à jour. Il n'a pas besoin du mot de passe MySQL dans GitHub.

## 2. Autoriser GitHub à se connecter en SSH

Le compte `deploy` existant peut être réutilisé. Une clé dédiée à ce dépôt
permet de révoquer son accès indépendamment de Terrains. Sur ton ordinateur,
dans un dossier situé hors du dépôt :

```sh
ssh-keygen -t ed25519 -C "github-actions-procedural-planets" -f ./planets_deploy
```

Laisser la passphrase vide pour cette clé d'automatisation. Ajouter uniquement
le contenu de `planets_deploy.pub` à `/home/deploy/.ssh/authorized_keys` sur le
VPS, sans remplacer les clés existantes. Permissions : `.ssh` en 700 et
`authorized_keys` en 600, propriétaire `deploy`.

Tester depuis ton ordinateur :

```sh
ssh -i ./planets_deploy -p 22 deploy@ADRESSE_DU_VPS 'node --version; npm --version; pm2 --version'
```

Le fichier privé `planets_deploy` sera copié dans un secret GitHub. Ne jamais
le committer, le placer dans le dossier du projet ou le transmettre dans le chat.
Ces clés servent à **GitHub → VPS** : inutile d'ajouter une Deploy key dans
GitHub, puisque le VPS n'effectue pas de `git pull`.

## 3. Renseigner GitHub

Ouvrir [les réglages Actions du dépôt](https://github.com/ZyFou/ProceduralPlanets/settings/secrets/actions)
→ **Settings → Secrets and variables → Actions → Secrets → New repository secret**.

| Secret | Valeur |
| --- | --- |
| `DEPLOY_HOST` | IP publique ou nom SSH du VPS, sans `https://` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Tout le contenu du fichier privé `planets_deploy`, lignes BEGIN/END comprises |
| `DEPLOY_KNOWN_HOSTS` | Ligne de clé publique SSH du serveur obtenue et vérifiée ci-dessous |

Pour obtenir la ligne `known_hosts`, depuis ton ordinateur :

```sh
ssh-keyscan -p 22 -t ed25519 ADRESSE_DU_VPS > planets_known_hosts
ssh-keygen -lf planets_known_hosts
```

Vérifier l'empreinte affichée contre celle fournie directement par le VPS via
une session de confiance ou sa console :

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Une fois les empreintes identiques, copier le contenu de `planets_known_hosts`
dans `DEPLOY_KNOWN_HOSTS`. Le workflow refuse une clé de serveur différente.
Si le port SSH n'est pas 22, remplacer 22 dans les commandes précédentes.

Dans l'onglet **Variables → New repository variable**, les deux réglages
facultatifs sont :

| Variable | Valeur par défaut |
| --- | --- |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/home/ProceduralPlanets` |

Le dossier doit être réservé à Planets et déjà appartenir à `deploy`.
Le workflow synchronise `web/` et `api/` avec `rsync --delete` : ne pas y
placer d'autres applications ou fichiers à conserver, hormis le `.env` et
les répertoires explicitement exclus (`node_modules`, `logs`, `uploads`, `storage`).
Pour changer un chemin déjà en service, adapter également les processus PM2
existants pendant le basculement.

Documentation officielle : [secrets GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 4. Routage dans Pangolin

Le routage et HTTPS sont configurés par l'opérateur dans Pangolin :

| Domaine | Service cible |
| --- | --- |
| `procedural-planets.com` | Front HTTP sur le VPS, port `7071` |
| `api.procedural-planets.com` | API HTTP sur le VPS, port `7070` |

Utiliser une adresse du VPS accessible depuis le connecteur. Le modèle
`api.env.example` utilise `API_HOST=127.0.0.1` : cette adresse convient si le
connecteur accède au même espace réseau que l'API. S'il tourne dans un
conteneur avec un réseau séparé, adapter `API_HOST` à une interface accessible
(ou `0.0.0.0` avec un pare-feu limitant l'accès) et utiliser cette adresse
comme cible. Les contrôles de santé du déploiement s'exécutent sur le VPS via
`127.0.0.1` ; conserver une écoute compatible avec ces contrôles.

Garder `COOKIE_SECURE=true` et `TRUST_PROXY=true` dans `api/.env` pour
l'accès public en HTTPS derrière le proxy. Aucune installation Nginx ou
Certbot supplémentaire n'est prévue par ce déploiement.

## 5. Premier déploiement

Une fois le VPS et les secrets prêts, publier ces changements sur `main`
(ou les intégrer via une pull request). Puis suivre l'exécution dans **Actions**.
Une exécution manuelle doit aussi sélectionner **main** ; sur une autre
branche, le job de déploiement est ignoré.

Sous `deploy`, vérifier :

```sh
pm2 status
curl --fail https://procedural-planets.com/ -o /dev/null
curl --fail https://api.procedural-planets.com/api/v1/health
pm2 logs procedural-planets-api --lines 50 --nostream
```

Tester aussi inscription/connexion et sauvegarde d'une planète depuis le site.
Si le site charge mais que la connexion échoue, vérifier HTTPS et
`FRONTEND_ORIGINS=https://procedural-planets.com` dans `api/.env`.

Pour démarrer après un redémarrage du VPS, si PM2 n'est pas déjà configuré
pour **deploy**, lancer `pm2 startup systemd` sous ce compte, exécuter la
commande sudo qu'il indique, puis `pm2 save`. Ne pas créer un deuxième
service si celui de Terrains gère déjà PM2 sous le même utilisateur.

## Mises à jour et limites

Les prochains pushes sur `main` suivent la même procédure automatiquement.
Les déploiements GitHub sont sérialisés et ne s'interrompent pas mutuellement.
Les fichiers sont remplacés sur place : un bref arrêt ou une incohérence
temporaire est possible pendant la mise à jour. Il n'y a pas de rollback
automatique. Une migration SQL peut modifier la base même si un contrôle
ultérieur échoue : conserver des sauvegardes MySQL avant les changements de
schéma. Relancer une ancienne version du code ne restaure pas la base.
