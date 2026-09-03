#!/usr/bin/env python3
"""Jeu de donnees d'exemple pour HEIG-Echange (comptes d'essai + 30 annonces).

Cree, sur une instance locale ou de staging :

  * 10 comptes etudiants  essai1@heig-vd.ch ... essai10@heig-vd.ch,
    avec des prenoms/noms tires de personas suisses et europeens courants ;
  * 1 compte administrateur echange.admin@heig-vd.ch ;
  * 30 annonces reparties sur les 5 premiers comptes d'essai (6 chacun),
    chacune avec 1 a 3 photos.

Tous les comptes partagent le meme mot de passe (--password, par defaut
"heigpdg2026").

Le peuplement passe par l'API HTTP publique : aucune ecriture directe en base,
donc les regles metier (domaine de l'email, confirmation obligatoire, plafond
de photos) sont respectees comme pour un vrai utilisateur. Seule exception : le
passage du compte admin en role "admin", que l'API n'expose pas — il est fait
en SQL via `docker compose exec db` (voir --skip-admin-promotion).

Uniquement la bibliotheque standard : aucun `pip install`.

--------------------------------------------------------------------------
Prerequis
--------------------------------------------------------------------------
L'application doit exposer les codes de confirmation dans ses reponses, sans
quoi le script ne peut pas activer les comptes qu'il cree :

    EXPOSE_VERIFICATION_CODE_FOR_TESTING=true

C'est le cas avec la surcouche de developpement (compose.dev.yaml).
Ne JAMAIS activer cette variable en production : elle divulgue les codes.

--------------------------------------------------------------------------
Utilisation
--------------------------------------------------------------------------
    # base neuve : detruit le volume, relance la stack de dev, puis peuple
    python3 scripts/seed_sample_data.py --reset

    # instance deja demarree
    python3 scripts/seed_sample_data.py

    # ailleurs / autres options
    python3 scripts/seed_sample_data.py --base-url https://staging.exemple.ch
    python3 scripts/seed_sample_data.py --photos-dir ./mes-photos
    python3 scripts/seed_sample_data.py --dry-run

Le script est reentrant : relance sur une base deja peuplee, il reutilise les
comptes existants (409 a l'inscription) et republie les annonces manquantes.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import mimetypes
import os
import random
import struct
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
import zlib

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


DEFAULT_BASE_URL = os.environ.get("SEED_BASE_URL", "http://localhost:3000")
DEFAULT_PASSWORD = os.environ.get("SEED_PASSWORD", "heigpdg2026")

ADMIN_EMAIL = "echange.admin@heig-vd.ch"
ADMIN_DISPLAY_NAME = "Equipe HEIG-Echange"

STUDENT_COUNT = 10          # essai1 ... essai10
PUBLISHER_COUNT = 5         # seuls les 5 premiers publient des annonces

# Graine fixe : les memes noms et les memes photos d'une execution a l'autre,
# donc une relance ne cree pas un deuxieme jeu de donnees legerement different.
SEED = 20260903


# ---------------------------------------------------------------------------
# Personas — prenoms/noms courants en Suisse romande, alemanique et en Europe
# ---------------------------------------------------------------------------

FIRST_NAMES = [
    "Lea", "Noah", "Elena", "Luca", "Mia", "Nils", "Chiara", "Jonas",
    "Alina", "Matteo", "Sarah", "Timo", "Ines", "Robin", "Anouk", "Yannick",
    "Clara", "Sven", "Nadia", "Gabriel", "Emma", "Loris", "Selma", "Fabio",
    "Camille", "Andrin", "Zoe", "Kilian", "Marta", "Elias",
]

LAST_NAMES = [
    "Meier", "Favre", "Rossi", "Schmid", "Dubois", "Keller", "Perren",
    "Brunner", "Sanchez", "Nowak", "Widmer", "Bianchi", "Moreau", "Steiner",
    "Da Silva", "Huber", "Marchand", "Zimmermann", "Kovac", "Lopes",
    "Baumann", "Girard", "Frei", "Ferrari", "Aebischer", "Petit", "Graf",
    "Vogel", "Muller", "Colombo",
]


def build_students(rng: random.Random) -> list[dict]:
    """essaiX@heig-vd.ch + un nom/prenom tire au sort, sans doublon."""
    first = rng.sample(FIRST_NAMES, STUDENT_COUNT)
    last = rng.sample(LAST_NAMES, STUDENT_COUNT)
    return [
        {
            "key": f"essai{i + 1}",
            "email": f"essai{i + 1}@heig-vd.ch",
            "displayName": f"{first[i]} {last[i]}",
        }
        for i in range(STUDENT_COUNT)
    ]


# ---------------------------------------------------------------------------
# Annonces — 30 objets plausibles de vie etudiante
#
# "category" renvoie au slug d'une categorie du seed SQL (db/init/02-seed.sql).
# Le proprietaire n'est pas ecrit ici : il est attribue en tourniquet sur les
# PUBLISHER_COUNT premiers comptes (6 annonces chacun).
# ---------------------------------------------------------------------------

LISTINGS = [
    {
        "category": "electronique",
        "title": "Calculatrice HP Prime G2",
        "description": (
            "Utilisee pendant deux semestres, en parfait etat. Ideale pour "
            "l'analyse et l'algebre lineaire. Housse et cable USB inclus, la "
            "batterie tient encore une journee entiere de cours."
        ),
        "itemCondition": "tres_bon",
        "location": "Y-Parc, Yverdon-les-Bains",
    },
    {
        "category": "livres",
        "title": "Analyse 1 — recueil d'exercices corriges",
        "description": (
            "Fascicule complet avec les corriges, quelques annotations au "
            "crayon. Series, limites et integrales couvertes. Il a assez servi, "
            "je le passe au suivant."
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, batiment C",
    },
    {
        "category": "mobilier",
        "title": "Bureau IKEA Micke blanc",
        "description": (
            "Fin de bail, je dois liberer la chambre. Plateau 105x50 cm avec un "
            "tiroir, deux petites rayures. A demonter et venir chercher sur "
            "place, il rentre dans un coffre de voiture."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, quartier Pierre-de-Savoie",
    },
    {
        "category": "materiel",
        "title": "Kit Arduino Uno complet",
        "description": (
            "Carte Arduino Uno, breadboard, resistances, LED, capteurs et deux "
            "servomoteurs, le tout dans sa boite. Utilise pour un seul projet "
            "de semestre. Parfait pour demarrer en systemes embarques."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, laboratoire ISC",
    },
    {
        "category": "cuisine",
        "title": "Machine a cafe Nespresso Inissia",
        "description": (
            "Fonctionne parfaitement, detartree le mois dernier. Je passe au "
            "cafe filtre, autant qu'elle serve encore. Bac a capsules inclus."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, proche de la gare",
    },
    {
        "category": "sport",
        "title": "Raquette de badminton Yonex + volants",
        "description": (
            "Raquette d'entree de gamme avec housse, plus un tube de volants en "
            "plastique presque plein. De quoi depanner pour le sport facultatif."
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, salle de sport",
    },
    {
        "category": "vetements",
        "title": "Blouse de laboratoire taille M",
        "description": (
            "Blouse blanche en coton, lavee, sans taches ni brulures. Je change "
            "de filiere et je n'en ai plus l'usage."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, batiment B",
    },
    {
        "category": "divers",
        "title": "Lampe de bureau LED articulee",
        "description": (
            "Bras articule, trois niveaux d'intensite, alimentation USB. Tres "
            "pratique pour reviser tard sans se fatiguer les yeux."
        ),
        "itemCondition": "tres_bon",
        "location": "Y-Parc, Yverdon-les-Bains",
    },
    {
        "category": "electronique",
        "title": "Ecran Dell 24 pouces Full HD",
        "description": (
            "Ecran IPS 1920x1080, pied reglable en hauteur, cable HDMI fourni. "
            "Aucun pixel mort. Je passe a un ultra-large, celui-ci prend la "
            "poussiere."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, rue des Moulins",
    },
    {
        "category": "livres",
        "title": "Clean Code — Robert C. Martin",
        "description": (
            "Edition anglaise, couverture un peu marquee mais toutes les pages "
            "sont la. Une bonne lecture avant les projets de genie logiciel."
        ),
        "itemCondition": "usage",
        "location": "HEIG-VD, bibliotheque",
    },
    {
        "category": "mobilier",
        "title": "Chaise de bureau a roulettes",
        "description": (
            "Assise reglable, dossier en resille, accoudoirs. Le tissu est un "
            "peu use a l'assise mais le verin fonctionne tres bien."
        ),
        "itemCondition": "usage",
        "location": "Yverdon, avenue des Sports",
    },
    {
        "category": "materiel",
        "title": "Multimetre numerique + pinces crocodiles",
        "description": (
            "Multimetre de labo achete en premiere annee : tension, courant, "
            "resistance, continuite. Sondes et jeu de pinces crocodiles inclus."
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, laboratoire d'electronique",
    },
    {
        "category": "cuisine",
        "title": "Bouilloire electrique 1.7 L",
        "description": (
            "Bouilloire inox, filtre anticalcaire lavable, arret automatique. "
            "Elle vient d'une colocation qui se termine."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, colocation du centre",
    },
    {
        "category": "sport",
        "title": "Tapis de yoga + sangle de transport",
        "description": (
            "Tapis antiderapant de 6 mm, nettoye. Utilise deux fois en tout, "
            "les bonnes resolutions n'ont pas tenu le semestre."
        ),
        "itemCondition": "tres_bon",
        "location": "Yverdon-les-Bains",
    },
    {
        "category": "divers",
        "title": "Guirlande lumineuse 10 m",
        "description": (
            "Guirlande a piles avec petites LED blanches chaudes, huit modes. "
            "Parfaite pour rendre une chambre d'etudiant plus accueillante."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, batiment A",
    },
    {
        "category": "electronique",
        "title": "Lot de cables et adaptateurs",
        "description": (
            "USB-C, HDMI, jack 3.5 mm, adaptateur VGA pour les presentations en "
            "salle de cours. Tout fonctionne, j'ai des doublons depuis que j'ai "
            "change de portable."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, cafeteria",
    },
    {
        "category": "livres",
        "title": "Physique generale — Halliday & Resnick",
        "description": (
            "Gros volume relie, edition francaise. Quelques passages surlignes "
            "en jaune dans les chapitres de mecanique, le reste est intact."
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, bibliotheque",
    },
    {
        "category": "mobilier",
        "title": "Etagere Kallax 2x2 cases",
        "description": (
            "Etagere blanche 77x77 cm, deja demontee et sanglee avec sa "
            "visserie dans un sachet. Un angle est legerement ecaille."
        ),
        "itemCondition": "usage",
        "location": "Yverdon, quartier des Cygnes",
    },
    {
        "category": "materiel",
        "title": "Set de dessin technique (equerres, compas)",
        "description": (
            "Equerres, rapporteur, compas de precision et porte-mines dans un "
            "etui rigide. Achete pour un cours de construction, jamais reutilise."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, batiment C",
    },
    {
        "category": "vetements",
        "title": "Veste polaire taille L",
        "description": (
            "Polaire noire, poches zippees, chaude et sans bouloches. Elle me "
            "va trop grand depuis longtemps."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, quartier de la Villette",
    },
    {
        "category": "electronique",
        "title": "Casque audio filaire a arceau",
        "description": (
            "Casque circum-aural avec cable detachable et micro pour les cours "
            "a distance. La mousse de l'oreillette gauche est un peu tassee."
        ),
        "itemCondition": "usage",
        "location": "HEIG-VD, salle d'etude",
    },
    {
        "category": "cuisine",
        "title": "Lot de vaisselle pour colocation",
        "description": (
            "Six assiettes plates, quatre bols, une dizaine de couverts "
            "depareilles et deux casseroles. De quoi equiper une chambre "
            "d'etudiant du jour au lendemain."
        ),
        "itemCondition": "usage",
        "location": "Yverdon, colocation Pierre-de-Savoie",
    },
    {
        "category": "sport",
        "title": "Velo de ville a reviser",
        "description": (
            "Cadre en bon etat, sept vitesses, mais les cables de freins sont a "
            "changer et les pneus a regonfler. Pour quelqu'un qui bricole."
        ),
        "itemCondition": "a_reparer",
        "location": "Yverdon, parking a velos de la HEIG",
    },
    {
        "category": "divers",
        "title": "Sac a dos ordinateur 15 pouces",
        "description": (
            "Compartiment rembourre pour un portable 15 pouces, deux poches "
            "laterales, fermetures qui fonctionnent toutes. Un peu delave."
        ),
        "itemCondition": "usage",
        "location": "HEIG-VD, batiment B",
    },
    {
        "category": "livres",
        "title": "Introduction aux bases de donnees",
        "description": (
            "Manuel du cours : modele relationnel, SQL, normalisation et "
            "transactions. Neuf, je l'avais achete en double par erreur."
        ),
        "itemCondition": "neuf",
        "location": "HEIG-VD, batiment C",
    },
    {
        "category": "materiel",
        "title": "Fer a souder et bobine d'etain",
        "description": (
            "Fer a souder 30 W avec support metallique, eponge et une bobine "
            "d'etain entamee. Suffisant pour les travaux pratiques."
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, laboratoire d'electronique",
    },
    {
        "category": "mobilier",
        "title": "Matelas simple 90x200 propre",
        "description": (
            "Matelas mousse d'appoint, housse lavee, aucune tache ni odeur. "
            "Il servait aux invites, la chambre est trop petite pour le garder."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, quartier Sous-Bois",
    },
    {
        "category": "vetements",
        "title": "Chaussures de securite pointure 43",
        "description": (
            "Chaussures coquees exigees en atelier, portees une dizaine de "
            "fois. Semelles encore franches, lacets d'origine."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, atelier mecanique",
    },
    {
        "category": "electronique",
        "title": "Disque dur externe 500 Go",
        "description": (
            "Boitier 2.5 pouces USB 3.0, formate et teste avant le don. Un peu "
            "juste pour aujourd'hui, tres bien pour des sauvegardes de cours."
        ),
        "itemCondition": "bon",
        "location": "Y-Parc, Yverdon-les-Bains",
    },
    {
        "category": "divers",
        "title": "Plantes vertes en pot (lot de trois)",
        "description": (
            "Un pothos, un cactus et une petite succulente, tous en bonne "
            "sante. Je pars en echange et je ne veux pas les laisser secher."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, avenue de Grandson",
    },
]


# ---------------------------------------------------------------------------
# Generation d'images de remplacement
# ---------------------------------------------------------------------------

# Palette dans les tons de la maquette (rouge HEIG, creme, gris chauds).
# Separee en fonds clairs et tons soutenus : en tirant le degrade dans l'un et
# le bloc central dans l'autre, l'objet reste toujours lisible sur son fond.
BACKGROUNDS = [
    (245, 244, 240),
    (232, 229, 224),
    (214, 210, 204),
]

ACCENTS = [
    (200, 16, 46),
    (163, 13, 37),
    (122, 118, 112),
    (26, 24, 22),
]


def make_placeholder_png(width: int, height: int, seed: int) -> bytes:
    """Fabrique un PNG (degrade + bloc central) sans dependance externe.

    On ecrit le PNG a la main (en-tete, IHDR, IDAT compresse, IEND) plutot que
    d'embarquer des binaires dans le depot ou d'aller les chercher sur
    Internet : le script reste utilisable hors ligne.
    """
    rng = random.Random(seed)
    top = BACKGROUNDS[rng.randrange(len(BACKGROUNDS))]
    bottom = BACKGROUNDS[rng.randrange(len(BACKGROUNDS))]
    accent = ACCENTS[rng.randrange(len(ACCENTS))]

    # Bloc central, comme la silhouette d'un objet pose sur un fond : cela
    # suffit a distinguer les photos les unes des autres dans le carrousel.
    bx0 = int(width * rng.uniform(0.18, 0.30))
    bx1 = int(width * rng.uniform(0.70, 0.84))
    by0 = int(height * rng.uniform(0.22, 0.34))
    by1 = int(height * rng.uniform(0.66, 0.80))

    raw = bytearray()
    for y in range(height):
        ratio = y / max(1, height - 1)
        row = bytearray([0])  # filtre 0 (None) en tete de chaque ligne
        for x in range(width):
            # Legere variation horizontale pour que le fond ne soit pas plat.
            wobble = 0.12 * ((x / max(1, width - 1)) - 0.5)
            t = min(1.0, max(0.0, ratio + wobble))
            if bx0 <= x < bx1 and by0 <= y < by1:
                row += bytes(accent)
            else:
                row += bytes(
                    int(top[c] + (bottom[c] - top[c]) * t) for c in range(3)
                )
        raw += row

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8 bits, RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )


def load_photo_pool(photos_dir: str | None) -> list[tuple[str, bytes]]:
    """Charge les images d'un dossier, ou renvoie une liste vide."""
    if not photos_dir:
        return []

    pool: list[tuple[str, bytes]] = []
    for name in sorted(os.listdir(photos_dir)):
        path = os.path.join(photos_dir, name)
        mime, _ = mimetypes.guess_type(path)
        if not os.path.isfile(path) or mime not in {
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
        }:
            continue
        with open(path, "rb") as handle:
            pool.append((name, handle.read()))

    if not pool:
        print(f"  ! aucune image exploitable dans {photos_dir}", file=sys.stderr)
    return pool


# ---------------------------------------------------------------------------
# Client HTTP minimal
# ---------------------------------------------------------------------------


class ApiError(Exception):
    def __init__(self, status: int, message: str, payload: dict | None = None):
        super().__init__(f"HTTP {status} — {message}")
        self.status = status
        self.payload = payload or {}


class Client:
    """Client HTTP avec cookies : une instance = une session utilisateur."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar)
        )

    def _send(self, request: urllib.request.Request):
        try:
            with self.opener.open(request, timeout=30) as response:
                body = response.read()
        except urllib.error.HTTPError as err:
            body = err.read()
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                payload = {}
            raise ApiError(
                err.code, payload.get("error", err.reason), payload
            ) from None
        except urllib.error.URLError as err:
            raise SystemExit(
                f"Impossible de joindre {self.base_url} : {err.reason}\n"
                "L'application est-elle demarree (docker compose up) ?"
            ) from None

        if not body:
            return {}
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {}

    def get(self, path: str):
        return self._send(urllib.request.Request(self.base_url + path))

    def post(self, path: str, payload: dict):
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return self._send(request)

    def upload(self, path: str, files: list[tuple[str, str, bytes]]):
        """POST multipart/form-data. files = [(champ, nom, contenu), ...]."""
        boundary = f"----heig{uuid.uuid4().hex}"
        body = bytearray()
        for field, filename, content in files:
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            body += f"--{boundary}\r\n".encode()
            body += (
                f'Content-Disposition: form-data; name="{field}"; '
                f'filename="{filename}"\r\n'.encode()
            )
            body += f"Content-Type: {mime}\r\n\r\n".encode()
            body += content + b"\r\n"
        body += f"--{boundary}--\r\n".encode()

        request = urllib.request.Request(
            self.base_url + path,
            data=bytes(body),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        return self._send(request)


# ---------------------------------------------------------------------------
# Docker : remise a zero de la base et promotion du compte admin
# ---------------------------------------------------------------------------

COMPOSE_DEV = ["-f", "compose.yaml", "-f", "compose.dev.yaml"]


def compose(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", "compose", *args], cwd=REPO_ROOT, check=False, **kwargs
    )


def read_env_file() -> dict[str, str]:
    """Lit .env a la racine du depot (format KEY=VALUE), s'il existe."""
    values: dict[str, str] = {}
    path = os.path.join(REPO_ROOT, ".env")
    if not os.path.isfile(path):
        return values
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def reset_database() -> None:
    """Detruit les volumes et relance la stack de developpement.

    `down -v` efface db-data ET uploads-data : au redemarrage, MariaDB rejoue
    db/init/01-schema-v2.sql puis 02-seed.sql sur un volume vide, ce qui est le
    seul moyen d'obtenir un schema propre sans passer par les migrations.
    """
    print("Remise a zero de la base (docker compose down -v)…")
    compose([*COMPOSE_DEV, "down", "-v"])
    print("Redemarrage de la stack de developpement…")
    result = compose([*COMPOSE_DEV, "up", "--build", "-d", "--wait"])
    if result.returncode != 0:
        raise SystemExit(
            "Le demarrage de la stack a echoue. Verifiez la sortie de Docker "
            "ci-dessus (fichier .env present ? ports libres ?)."
        )


def promote_admin(email: str) -> bool:
    """Passe un compte en role 'admin' via le conteneur MariaDB.

    L'API ne propose volontairement aucune route pour se donner les droits
    d'administration : c'est donc la seule etape qui ecrit directement en base.
    """
    env = read_env_file()
    database = env.get("MARIADB_DATABASE", "heig_echange")
    root_password = env.get("MARIADB_ROOT_PASSWORD")
    statement = f"UPDATE users SET role = 'admin' WHERE email = '{email}';"

    if not root_password:
        print(
            "  ! MARIADB_ROOT_PASSWORD introuvable dans .env — promotion "
            "manuelle necessaire.",
            file=sys.stderr,
        )
        return False

    result = compose(
        [
            *COMPOSE_DEV,
            "exec",
            "-T",
            "db",
            "mariadb",
            "-uroot",
            f"-p{root_password}",
            database,
            "-e",
            statement,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(
            "  ! promotion automatique impossible : "
            f"{(result.stderr or '').strip() or 'docker indisponible'}",
            file=sys.stderr,
        )
        return False
    return True


# ---------------------------------------------------------------------------
# Etapes du peuplement
# ---------------------------------------------------------------------------


def ensure_user(base_url: str, user: dict, password: str) -> Client:
    """Inscrit (si besoin), confirme l'adresse et ouvre une session."""
    client = Client(base_url)
    email = user["email"]

    try:
        account = client.post(
            "/auth/register",
            {
                "email": email,
                "displayName": user["displayName"],
                "password": password,
            },
        )
        code = account.get("devVerificationCode")
        if not code:
            raise SystemExit(
                "L'API n'a pas renvoye de code de confirmation.\n"
                "Demarrez l'application avec EXPOSE_VERIFICATION_CODE_FOR_TESTING=true "
                "(voir compose.dev.yaml), sinon le script ne peut pas activer les comptes."
            )
        client.post("/auth/verify-email", {"email": email, "code": code})
        print(f"  + compte cree et confirme : {email} ({user['displayName']})")
    except ApiError as err:
        if err.status != 409:
            raise
        print(f"  = compte deja present : {email}")

    try:
        client.post("/auth/login", {"email": email, "password": password})
    except ApiError as err:
        if err.status == 403 and err.payload.get("code") == "EMAIL_REVERIFICATION_REQUIRED":
            # Compte cree il y a plus de 6 mois par une execution precedente :
            # l'API vient d'envoyer un nouveau code, on le consomme.
            code = err.payload.get("devVerificationCode")
            if not code:
                raise SystemExit(
                    f"{email} doit reconfirmer son adresse et le code n'est pas "
                    "expose. Relancez avec EXPOSE_VERIFICATION_CODE_FOR_TESTING=true."
                ) from None
            client.post("/auth/verify-email", {"email": email, "code": code})
            client.post("/auth/login", {"email": email, "password": password})
            print(f"  ~ adresse reconfirmee : {email}")
        else:
            raise

    return client


def photo_files(index: int, count: int, pool: list[tuple[str, bytes]]):
    """Renvoie les fichiers a attacher a une annonce."""
    if pool:
        return [
            (
                f"seed-{index}-{i}-{pool[(index + i) % len(pool)][0]}",
                pool[(index + i) % len(pool)][1],
            )
            for i in range(count)
        ]
    return [
        (
            f"seed-{index}-{i}.png",
            make_placeholder_png(800, 600, seed=index * 10 + i),
        )
        for i in range(count)
    ]


def plan_listings(students: list[dict], rng: random.Random) -> list[dict]:
    """Attribue chaque annonce a un compte publieur et un nombre de photos."""
    return [
        {
            **spec,
            "owner": students[index % PUBLISHER_COUNT]["key"],
            "photos": rng.randint(1, 3),
            "index": index,
        }
        for index, spec in enumerate(LISTINGS)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Peuple HEIG-Echange avec un jeu de donnees d'exemple.",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"URL de l'application (defaut : {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--password",
        default=DEFAULT_PASSWORD,
        help=f"Mot de passe donne a tous les comptes (defaut : {DEFAULT_PASSWORD}).",
    )
    parser.add_argument(
        "--photos-dir",
        help="Dossier d'images a utiliser. Sans lui, des visuels sont generes.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="DESTRUCTIF : detruit les volumes Docker (base + uploads), relance "
        "la stack de developpement sur une base vierge, puis peuple.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Ne pas demander confirmation pour --reset.",
    )
    parser.add_argument(
        "--skip-admin-promotion",
        action="store_true",
        help="Cree le compte admin mais ne le passe pas en role 'admin' "
        "(utile si Docker n'est pas joignable depuis cette machine).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche ce qui serait cree, sans rien envoyer.",
    )
    args = parser.parse_args()

    if len(args.password) < 8:
        parser.error("le mot de passe doit faire au moins 8 caracteres")

    rng = random.Random(SEED)
    students = build_students(rng)
    admin = {
        "key": "admin",
        "email": ADMIN_EMAIL,
        "displayName": ADMIN_DISPLAY_NAME,
    }
    planned = plan_listings(students, rng)

    if args.dry_run:
        print(f"[dry-run] {len(students)} comptes etudiants + 1 admin :")
        for user in students:
            print(f"  - {user['email']:<24} {user['displayName']}")
        print(f"  - {admin['email']:<24} {admin['displayName']} (role admin)")
        print(f"\n[dry-run] {len(planned)} annonces :")
        for spec in planned:
            print(
                f"  - [{spec['owner']}] {spec['title']} "
                f"({spec['category']}, {spec['photos']} photo(s))"
            )
        print(f"\n[dry-run] mot de passe commun : {args.password}")
        return 0

    if args.reset:
        if not args.yes:
            answer = (
                input(
                    "--reset supprime DEFINITIVEMENT la base et les images "
                    "uploadees de cette instance. Continuer ? [oui/non] "
                )
                .strip()
                .lower()
            )
            if answer not in {"oui", "o", "yes", "y"}:
                print("Abandon.")
                return 1
        reset_database()

    print(f"Cible : {args.base_url}")

    # Verification de disponibilite avant de commencer a ecrire.
    probe = Client(args.base_url)
    health = probe.get("/health")
    if health.get("status") != "ok":
        print("L'application ne repond pas 'ok' sur /health.", file=sys.stderr)
        return 1

    categories = {c["slug"]: c["id"] for c in probe.get("/categories")}
    if not categories:
        print(
            "Aucune categorie en base : le seed SQL (db/init/02-seed.sql) n'a pas "
            "ete joue. Relancez avec --reset pour recreer le volume.",
            file=sys.stderr,
        )
        return 1

    photo_pool = load_photo_pool(args.photos_dir)

    print("\nComptes etudiants")
    sessions: dict[str, Client] = {}
    for user in students:
        sessions[user["key"]] = ensure_user(args.base_url, user, args.password)

    print("\nCompte administrateur")
    ensure_user(args.base_url, admin, args.password)
    if args.skip_admin_promotion:
        print("  ~ promotion en role 'admin' ignoree (--skip-admin-promotion)")
    elif promote_admin(ADMIN_EMAIL):
        print(f"  + {ADMIN_EMAIL} est maintenant administrateur")
    else:
        print(
            "    A executer a la main (phpMyAdmin ou client SQL) :\n"
            f"      UPDATE users SET role = 'admin' WHERE email = '{ADMIN_EMAIL}';"
        )

    # Annonces deja en ligne : on ne republie pas les memes a chaque execution.
    existing_titles = {listing["title"] for listing in probe.get("/listings")}

    print("\nAnnonces")
    created = 0
    for spec in planned:
        if spec["title"] in existing_titles:
            print(f"  = deja en ligne : {spec['title']}")
            continue

        category_id = categories.get(spec["category"])
        if category_id is None:
            print(
                f"  ! categorie inconnue, ignoree : {spec['category']}",
                file=sys.stderr,
            )
            continue

        client = sessions[spec["owner"]]
        listing = client.post(
            "/listings",
            {
                "categoryId": category_id,
                "title": spec["title"],
                "description": spec["description"],
                "itemCondition": spec["itemCondition"],
                "location": spec["location"],
            },
        )

        files = [
            ("photos", name, content)
            for name, content in photo_files(
                spec["index"], spec["photos"], photo_pool
            )
        ]
        client.upload(f"/listings/{listing['id']}/photos", files)
        created += 1
        print(f"  + [{spec['owner']}] {spec['title']} ({len(files)} photo(s))")

    print(
        f"\nTermine : {len(students)} comptes d'essai, 1 admin, "
        f"{created} annonce(s) publiee(s) sur cette execution."
    )
    print(f"Connexion : essai1@heig-vd.ch … essai10@heig-vd.ch / {ADMIN_EMAIL}")
    print(f"Mot de passe commun : {args.password}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
