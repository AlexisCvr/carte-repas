# Caisse Repas — V1

Application web installable (PWA) avec serveur + fichier JSON local. Les données ne dépendent pas de Google Sheets.

## Ce que contient cette V1
- Connexion persistante par session
- Compte administrateur + compte caisse
- Recherche par nom ou ID
- Fiche personne et solde
- Crédit / Repas / Apéro
- Méthodes Virement / Espèces / Carte
- Historique
- Tableau de bord
- Ajout de personnes (admin)
- Suppression/correction des transactions (API admin)
- Export JSON de sauvegarde (admin)
- PWA installable sur téléphone
- Route fallback pour éviter les erreurs "Page Not Found" lors de la navigation

## Comptes de démonstration
- Caisse : `caisse` / `Caisse123!`
- Admin : `admin` / `ChangeMe123!`

**À changer avant mise en ligne.**

## Lancer sur un PC
Node.js 20+ est requis. Aucun Python ni compilation native n'est nécessaire.

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:3000`.

## Mise en ligne
Déployer le dossier sur un hébergeur Node.js avec un stockage disque persistant pour `caisse.db`.
Définir au minimum:
- `SESSION_SECRET` = une longue valeur aléatoire
- `ADMIN_PASSWORD`
- `OPERATOR_PASSWORD`
- `NODE_ENV=production`

Pour une utilisation réelle à plusieurs téléphones, il faut un domaine HTTPS et un stockage persistant. La PWA peut ensuite être ajoutée à l'écran d'accueil.

## Import
La base initiale reprend les personnes et les opérations réellement présentes dans le fichier Excel fourni. Le fichier Excel reste intact et n'est pas nécessaire au fonctionnement de l'application.


## Accès participants
Chaque personne se connecte avec son ID et son code PIN à 4 chiffres. L'administrateur voit le code dans Admin et peut le modifier. Un participant ne voit que sa propre fiche.
