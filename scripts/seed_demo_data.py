#!/usr/bin/env python3
"""Remplit HEIG-Echange avec le jeu de donnees de demonstration de la maquette.

Cree des comptes etudiants, confirme leur adresse, publie les annonces de la
maquette Figma (avec plusieurs photos chacune) et enregistre quelques marques
d'interet, pour qu'une instance fraiche ressemble immediatement aux ecrans du
projet plutot qu'a une page vide.

Le script passe uniquement par l'API HTTP publique : il n'ecrit jamais en base
directement, donc les regles metier (domaine d'email, confirmation obligatoire,
plafond de photos) sont respectees comme pour un vrai utilisateur.

Uniquement la bibliotheque standard : aucun `pip install` n'est necessaire,
`python3 scripts/seed_demo_data.py` suffit.

--------------------------------------------------------------------------
Prerequis
--------------------------------------------------------------------------
L'application doit exposer les codes de confirmation dans ses reponses, sans
quoi le script ne peut pas activer les comptes qu'il cree :

    EXPOSE_VERIFICATION_CODE_FOR_TESTING=true

C'est le cas avec la surcouche de developpement :

    docker compose -f compose.yaml -f compose.dev.yaml up --build -d
    python3 scripts/seed_demo_data.py

Ne JAMAIS activer cette variable en production : elle divulgue les codes.

--------------------------------------------------------------------------
Utilisation
--------------------------------------------------------------------------
    python3 scripts/seed_demo_data.py
    python3 scripts/seed_demo_data.py --base-url https://staging.exemple.ch
    python3 scripts/seed_demo_data.py --photos-dir ./mes-photos
    python3 scripts/seed_demo_data.py --dry-run

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
import sys
import urllib.error
import urllib.request
import uuid
import zlib

DEFAULT_BASE_URL = os.environ.get("SEED_BASE_URL", "http://localhost:3000")
DEFAULT_PASSWORD = os.environ.get("SEED_PASSWORD", "demo-heig-2026")


# ---------------------------------------------------------------------------
# Jeu de donnees, calque sur la maquette Figma
# ---------------------------------------------------------------------------

USERS = [
    {
        "key": "martin",
        "email": "martin.dupont@heig-vd.ch",
        "displayName": "Martin Dupont",
    },
    {
        "key": "lucas",
        "email": "lucas.favre@heig-vd.ch",
        "displayName": "Lucas Favre",
    },
    {
        "key": "amina",
        "email": "amina.benali@heig-vd.ch",
        "displayName": "Amina Benali",
    },
    {
        "key": "sofia",
        "email": "sofia.henriques@heig-vd.ch",
        "displayName": "Sofia Henriques",
    },
    {
        "key": "vincent",
        "email": "vincent.bruzzese@heig-vd.ch",
        "displayName": "Vincent Bruzzese",
    },
]

# "owner" renvoie a la clef d'un compte ci-dessus, "category" au slug d'une
# categorie du seed SQL (db/init/02-seed.sql). "photos" est le nombre d'images
# a attacher : au-dela de 1, la fiche affiche un carrousel et la carte la
# pastille "+N" de la maquette.
LISTINGS = [
    {
        "owner": "lucas",
        "category": "electronique",
        "title": "Calculatrice HP Prime G2",
        "description": (
            "Utilisee pendant 2 semestres, en parfait etat. Ideale pour les cours "
            "d'analyse et d'algebre lineaire. Housse et cable USB inclus, la "
            "batterie tient encore toute une journee de cours."
        ),
        "itemCondition": "tres_bon",
        "location": "Y-Parc, Yverdon-les-Bains",
        "photos": 3,
    },
    {
        "owner": "amina",
        "category": "livres",
        "title": "Analyse 1 — Recueil d'exercices",
        "description": (
            "Fascicule corrige, quelques annotations au crayon. Tres complet pour "
            "reviser les series et les integrales. Je le donne, il a assez servi !"
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, batiment C",
        "photos": 2,
    },
    {
        "owner": "martin",
        "category": "mobilier",
        "title": "Bureau IKEA Micke blanc",
        "description": (
            "Fin de bail, je dois liberer la chambre. Bureau 105x50 cm avec un "
            "tiroir, deux petites rayures sur le plateau. A venir chercher sur "
            "place, il rentre dans un coffre de voiture une fois demonte."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, quartier Pierre-de-Savoie",
        "photos": 4,
    },
    {
        "owner": "martin",
        "category": "electronique",
        "title": "Lot de cables et adaptateurs",
        "description": (
            "USB-C, HDMI, jack, adaptateur VGA pour les presentations. Tout "
            "fonctionne, j'ai simplement des doublons depuis que j'ai change de "
            "portable."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, cafeteria",
        "photos": 2,
    },
    {
        "owner": "sofia",
        "category": "materiel",
        "title": "Kit Arduino Uno complet",
        "description": (
            "Carte Arduino Uno, breadboard, resistances, LED, capteurs et servos. "
            "Utilise pour un seul projet de semestre. Parfait pour demarrer en "
            "systemes embarques."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, laboratoire ISC",
        "photos": 3,
    },
    {
        "owner": "sofia",
        "category": "livres",
        "title": "Clean Code — Robert C. Martin",
        "description": (
            "Edition anglaise, couverture un peu marquee mais toutes les pages "
            "sont la. Une bonne lecture avant les projets de genie logiciel."
        ),
        "itemCondition": "usage",
        "location": "HEIG-VD, bibliotheque",
        "photos": 1,
    },
    {
        "owner": "vincent",
        "category": "cuisine",
        "title": "Machine a cafe Nespresso",
        "description": (
            "Fonctionne parfaitement, detartree recemment. Je passe au cafe "
            "filtre, autant qu'elle serve a quelqu'un d'autre. Bac a capsules "
            "inclus."
        ),
        "itemCondition": "bon",
        "location": "Yverdon, gare",
        "photos": 2,
    },
    {
        "owner": "vincent",
        "category": "sport",
        "title": "Raquette de badminton + volants",
        "description": (
            "Raquette Yonex d'entree de gamme avec housse, plus un tube de "
            "volants en plastique. De quoi depanner pour le sport facultatif."
        ),
        "itemCondition": "bon",
        "location": "HEIG-VD, salle de sport",
        "photos": 1,
    },
    {
        "owner": "amina",
        "category": "vetements",
        "title": "Blouse de laboratoire taille M",
        "description": (
            "Blouse blanche en coton, lavee, sans taches. Je change de filiere et "
            "je n'en ai plus besoin."
        ),
        "itemCondition": "tres_bon",
        "location": "HEIG-VD, batiment B",
        "photos": 1,
    },
    {
        "owner": "lucas",
        "category": "divers",
        "title": "Lampe de bureau LED",
        "description": (
            "Bras articule, trois niveaux d'intensite, alimentation USB. Tres "
            "pratique pour reviser tard sans se fatiguer les yeux."
        ),
        "itemCondition": "neuf",
        "location": "Y-Parc, Yverdon-les-Bains",
        "photos": 2,
    },
]

# Marques d'interet : (clef du compte interesse, titre de l'annonce).
INTERESTS = [
    ("martin", "Analyse 1 — Recueil d'exercices"),
    ("amina", "Calculatrice HP Prime G2"),
    ("sofia", "Calculatrice HP Prime G2"),
    ("vincent", "Bureau IKEA Micke blanc"),
    ("lucas", "Kit Arduino Uno complet"),
]


# ---------------------------------------------------------------------------
# Generation d'images de remplacement
# ---------------------------------------------------------------------------

# Palette dans les tons de la maquette (rouge HEIG, creme, gris chauds).
PALETTE = [
    (200, 16, 46),
    (163, 13, 37),
    (245, 244, 240),
    (232, 229, 224),
    (122, 118, 112),
    (26, 24, 22),
]


def make_placeholder_png(width: int, height: int, seed: int) -> bytes:
    """Fabrique un PNG en degrade, sans dependance externe.

    On ecrit le PNG a la main (en-tete, IHDR, IDAT compresse, IEND) plutot que
    d'embarquer des images binaires dans le depot ou d'aller les chercher sur
    Internet : le script reste utilisable hors ligne.
    """
    rng = random.Random(seed)
    top = PALETTE[rng.randrange(len(PALETTE))]
    bottom = PALETTE[rng.randrange(len(PALETTE))]

    raw = bytearray()
    for y in range(height):
        ratio = y / max(1, height - 1)
        row = bytearray([0])  # filtre 0 (None) en tete de chaque ligne
        for x in range(width):
            # Legere variation horizontale pour que l'image ne soit pas plate.
            wobble = 0.12 * ((x / max(1, width - 1)) - 0.5)
            t = min(1.0, max(0.0, ratio + wobble))
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

    def __init__(self, base_url: str, dry_run: bool = False):
        self.base_url = base_url.rstrip("/")
        self.dry_run = dry_run
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar)
        )

    def _send(self, request: urllib.request.Request) -> dict:
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

    def get(self, path: str) -> dict:
        return self._send(urllib.request.Request(self.base_url + path))

    def post(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return self._send(request)

    def upload(self, path: str, files: list[tuple[str, str, bytes]]) -> dict:
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
        print(f"  + compte cree et confirme : {email}")
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


def photos_for(spec: dict, index: int, pool: list[tuple[str, bytes]]):
    """Renvoie les fichiers a attacher a une annonce."""
    count = spec.get("photos", 1)
    if pool:
        return [
            (f"seed-{index}-{i}-{pool[(index + i) % len(pool)][0]}", pool[(index + i) % len(pool)][1])
            for i in range(count)
        ]
    return [
        (f"seed-{index}-{i}.png", make_placeholder_png(800, 600, seed=index * 10 + i))
        for i in range(count)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Peuple HEIG-Echange avec les donnees de la maquette."
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"URL de l'application (defaut : {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--password",
        default=DEFAULT_PASSWORD,
        help="Mot de passe donne a tous les comptes de demonstration.",
    )
    parser.add_argument(
        "--photos-dir",
        help="Dossier d'images a utiliser. Sans lui, des visuels sont generes.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche ce qui serait cree, sans rien envoyer.",
    )
    args = parser.parse_args()

    if len(args.password) < 8:
        parser.error("le mot de passe doit faire au moins 8 caracteres")

    print(f"Cible : {args.base_url}")

    if args.dry_run:
        print(f"\n[dry-run] {len(USERS)} comptes :")
        for user in USERS:
            print(f"  - {user['displayName']} <{user['email']}>")
        print(f"\n[dry-run] {len(LISTINGS)} annonces :")
        for spec in LISTINGS:
            print(
                f"  - {spec['title']} ({spec['category']}, "
                f"{spec['photos']} photo(s), par {spec['owner']})"
            )
        print(f"\n[dry-run] {len(INTERESTS)} marques d'interet.")
        return 0

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
            "ete joue. Recreez le volume de la base.",
            file=sys.stderr,
        )
        return 1

    photo_pool = load_photo_pool(args.photos_dir)

    print("\nComptes")
    sessions: dict[str, Client] = {}
    for user in USERS:
        sessions[user["key"]] = ensure_user(args.base_url, user, args.password)

    # Annonces deja en ligne : on ne republie pas les memes a chaque execution.
    existing_titles = {
        listing["title"] for listing in probe.get("/listings")
    }

    print("\nAnnonces")
    listing_ids: dict[str, int] = {}
    for index, spec in enumerate(LISTINGS):
        if spec["title"] in existing_titles:
            print(f"  = deja en ligne : {spec['title']}")
            continue

        category_id = categories.get(spec["category"])
        if category_id is None:
            print(f"  ! categorie inconnue, ignoree : {spec['category']}", file=sys.stderr)
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
        listing_ids[spec["title"]] = listing["id"]

        files = [
            ("photos", name, content)
            for name, content in photos_for(spec, index, photo_pool)
        ]
        if files:
            client.upload(f"/listings/{listing['id']}/photos", files)

        print(f"  + {spec['title']} ({len(files)} photo(s))")

    # Les ids des annonces deja presentes ne sont pas connus ci-dessus : on
    # complete depuis la liste publique pour pouvoir poser les interets.
    for listing in probe.get("/listings"):
        listing_ids.setdefault(listing["title"], listing["id"])

    print("\nMarques d'interet")
    for user_key, title in INTERESTS:
        listing_id = listing_ids.get(title)
        if listing_id is None:
            continue
        try:
            sessions[user_key].post(f"/listings/{listing_id}/interest", {})
            print(f"  + {user_key} → {title}")
        except ApiError as err:
            # 400 = c'est sa propre annonce ; 409/200 = deja enregistre.
            print(f"  ~ {user_key} → {title} ({err.status})")

    print(
        f"\nTermine. Connectez-vous avec n'importe quelle adresse ci-dessus "
        f"et le mot de passe : {args.password}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
