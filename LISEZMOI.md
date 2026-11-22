# 🐺 Les Loups de Brumeval

Jeu de loups-garous multijoueur **en 3D** dans le navigateur : un village avec **une maison par joueur** (16 max)
disposées en cercle autour de la place du conseil et de son feu de camp, la forêt et la tanière des loups.
**Chat de proximité** (texte + voix) et **nuits chronométrées** : chaque rôle doit faire son action
avant la fin du temps.

## Lancer le jeu sur ton ordinateur

1. Installe **Node.js** (version 18 ou plus) : https://nodejs.org
2. Double-clique sur **`lancer.bat`** (Windows) ou lance `./lancer.sh` (Mac/Linux).
   - Ou à la main : `npm install` puis `npm start`
3. Ouvre **http://localhost:3000** dans ton navigateur (Chrome, Edge ou Firefox).

## Comptes et niveaux

Pour jouer, il faut un **compte** (pseudo + mot de passe). Les mots de passe sont stockés
hachés (scrypt), jamais en clair. Chaque partie rapporte de l'**XP** : +20 pour avoir joué,
+40 en cas de victoire de son camp, +10 si on est encore en vie à la fin. Il faut 100 XP pour
passer au niveau 2, puis 50 de plus à chaque niveau. Les skins (débloqués par niveau) se
déclarent dans `accounts.js` (liste `SKINS`).

- **En local**, les comptes sont enregistrés dans `data/accounts.json`.
- **En ligne**, il faut une base PostgreSQL : renseigner sa connexion dans la variable
  d'environnement `DATABASE_URL` (par exemple une base gratuite Neon, https://neon.tech).
  Sans elle, sur Render, les comptes sont effacés à chaque redémarrage.

## Emotes

Chaque personnage a deux **mains volantes**. Touches **1 à 5** (ou la barre en bas de l'écran) :
👍 pouce vers le haut · 👎 pouce vers le bas · 👉 pointer du doigt · 🖕 doigt d'honneur · 🤚 « bof ».
Les joueurs qui vous voient voient le geste (la nuit, seuls les loups pendant leur tour peuvent en faire).

## Mode développeur

**Ctrl + Maj + D** (une fois connecté) ouvre le mode développeur, protégé par un **code secret** :
partie de test seul avec 2 à 15 **bots** qui jouent tous les rôles (déplacements, griffures,
boîtes aux lettres, votes, chat, emotes). On peut choisir son rôle et la durée des tours.
Les parties de test ne rapportent pas d'XP.

- **En local**, le code par défaut est `brumeval-dev`.
- **En ligne**, définir la variable d'environnement `DEV_CODE` (sur Render : *Environment*) avec
  un code que vous seul connaissez. Sans elle, le mode développeur est désactivé.

## Salons

Sur l'écran d'accueil : **« Créer une partie »** ouvre un nouveau salon avec un **code de 4 lettres**
(ex. `XACX`). Partage ce code, ou le lien du bouton **« 🔑 Salon · Copier le lien »**
(`…?salon=XACX`), à tes amis : ils entrent le code et cliquent sur **« Rejoindre »**.
Chaque salon a son propre village et sa propre partie (16 joueurs max par partie).
Un salon vide est fermé automatiquement au bout de 10 minutes.

## Faire jouer tes amis

- **Même Wi-Fi / même réseau** : le serveur affiche une adresse du type `https://192.168.x.x:3443`.
  Tes amis l'ouvrent, cliquent sur « Paramètres avancés → Continuer » (certificat auto-signé).
  Le HTTPS est obligatoire pour que le navigateur autorise le micro.
- **Par Internet** : le plus simple est un tunnel, par exemple
  `ngrok http 3000` (https://ngrok.com) ou Tailscale, et partager l'adresse https obtenue.
  Le vocal passe en pair-à-pair (WebRTC) ; sur certains réseaux très fermés il peut ne pas passer,
  le chat texte reste disponible.

Pour tester seul, ouvre plusieurs onglets **en navigation privée** (chaque onglet = un joueur).

## Règles

- **Commandes** : ZQSD / WASD / flèches pour bouger (par rapport à la caméra), **glisser la souris**
  pour tourner la caméra, **molette** pour zoomer, **Entrée** pour écrire.
- Chaque joueur a **sa maison** (son nom est affiché au-dessus). La nuit, on y est enfermé et on
  voit l'intérieur par le dessus ; au matin, on ressort devant sa porte.
- **Chat de proximité** : seuls les joueurs dans ton cercle pointillé t'entendent.
  Avec le vocal activé, le volume baisse avec la distance.
- **Nuit** : chaque joueur rentre dans sa maison. Les villageois y dorment : ils ne voient rien
  et ne peuvent pas parler. Les loups sortent discrètement de chez eux, rôdent dans le village et
  se parlent entre eux, avec une **voix déformée** pour qu'on ne les reconnaisse pas.
- **Petite Fille** : la nuit, **Q** ou **D** entrouvre le rideau de sa fenêtre gauche ou droite
  (**E** pour refermer). Elle regarde alors dehors **à la première personne**, par une fente
  étroite, en bougeant la souris, et entend les loups proches. Aucune lumière ne sort de la
  maison : seul le mouvement du rideau peut la trahir. De loin, un loup n'est qu'une
  silhouette : elle ne le reconnaît que s'il passe tout près. Mais les loups voient le rideau
  s'entrouvrir, et s'ils restent trop près trop longtemps, la meute découvre qui elle est.
- Chaque maison a deux fenêtres à rideaux et une **boîte aux lettres** avec le nom de l'habitant.
- **La nuit se joue en tours** : Cupidon (1ʳᵉ nuit), puis la Voyante, puis les Loups-Garous, puis
  la Sorcière. Chaque rôle a **30 secondes** (réglable) ; son tour se termine **dès que l'action
  est faite**. Action non faite = action perdue.
- **Loups-Garous** : pendant leur tour, ils sortent et vont **griffer la maison** de leur victime
  (touche **E**, tout près de la maison). Si toute la meute griffe la même maison, le choix est
  fait aussitôt ; si personne ne griffe, personne ne meurt. Les loups ne voient pas la Voyante.
- **Jour** : tout le monde se déplace et débat. Si plus de la moitié clique « Passer au vote »,
  le vote commence plus tôt.
- **Vote — le conseil du village** : tous les vivants sont réunis en cercle autour du feu, au centre
  de la place, et **ne peuvent pas quitter le cercle** jusqu'à la fin du vote. Tout le cercle
  s'entend. On vote en **cliquant sur un joueur** (ou dans la liste) ; le nombre de voix s'affiche
  au-dessus des têtes. En cas d'égalité, personne n'est éliminé.
- **Morts** : deviennent des fantômes, voient tous les rôles, entendent les vivants proches
  et ne parlent qu'aux autres fantômes.

| Rôle | Pouvoir |
|---|---|
| 🐺 Loup-Garou | Griffe chaque nuit la maison de sa victime |
| 🧑‍🌾 Villageois | Aucun, mais vote le jour |
| 🔮 Voyante | La nuit, sort de chez elle et ouvre la boîte aux lettres d'une maison (E) pour lire le rôle de l'habitant, puis rentre dormir. Les rôles découverts restent affichés pour elle |
| 🧪 Sorcière | Une potion de vie, une potion de mort |
| 🏹 Chasseur | En mourant, abat un joueur |
| 💘 Cupidon | Lie deux amoureux la 1ʳᵉ nuit |
| 👧 Petite Fille | Entrouvre sa porte (E) la nuit pour espionner les loups dans un cône étroit — risque d'être repérée |

**Victoire** : le village gagne quand tous les loups sont morts ; les loups quand il ne reste
qu'eux ; un couple d'amoureux s'il est seul survivant.

L'hôte (👑, premier connecté) règle le nombre de loups, les rôles et les chronos, et peut
écourter une phase avec le bouton « Terminer cette phase ».

## Options

Le rendu 3D utilise Three.js (inclus, fonctionne sans Internet). Une carte graphique récente
est conseillée ; sur un vieux PC, réduisez la taille de la fenêtre si c'est lent.

Ports modifiables : `PORT=4000 HTTPS_PORT=4443 npm start`
