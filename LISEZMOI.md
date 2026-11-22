# 🐺 Les Loups de Brumeval

Jeu de loups-garous multijoueur **en 3D** dans le navigateur : un village de 16 maisons
disposées en cercle autour de la place du conseil et de son feu de camp, la forêt et la tanière des loups.
**Chat de proximité** (texte + voix) et **nuits chronométrées** : chaque rôle doit faire son action
avant la fin du temps.

## Lancer le jeu sur ton ordinateur

1. Installe **Node.js** (version 18 ou plus) : https://nodejs.org
2. Double-clique sur **`lancer.bat`** (Windows) ou lance `./lancer.sh` (Mac/Linux).
   - Ou à la main : `npm install` puis `npm start`
3. Ouvre **http://localhost:3000** dans ton navigateur (Chrome, Edge ou Firefox).

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
- **Petite Fille** : la nuit, touche **E** pour entrouvrir sa porte. Elle voit un cône étroit dans la
  direction de la souris et entend les loups proches. De loin, un loup n'est qu'une silhouette :
  elle ne le reconnaît que s'il passe tout près. Mais un loup qui s'approche voit la lumière
  de la porte, et s'il reste trop près trop longtemps, la meute découvre qui elle est.
  Chaque rôle a un chrono : action non faite = action perdue.
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
| 🐺 Loup-Garou | Vote chaque nuit pour dévorer un villageois |
| 🧑‍🌾 Villageois | Aucun, mais vote le jour |
| 🔮 Voyante | Découvre le rôle d'un joueur par nuit |
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
