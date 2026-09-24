#!/usr/bin/env python3
"""
Genere automatiquement les 30 images pertinentes du jeu de donnees
HEIG-Echange via l'API Hugging Face.

Prerequis :
    pip install python-dotenv requests

Configuration :
    Creez un fichier .env :

        HUGGINGFACE_API_KEY=hf_votre_cle

Utilisation :
    python3 generate_sample_images.py

    # Choisir un autre dossier :
    python3 generate_sample_images.py --output-dir ./sample-images

    # Generer seulement les images manquantes :
    python3 generate_sample_images.py --skip-existing

    # Choisir le modele :
    python3 generate_sample_images.py --model black-forest-labs/FLUX.1-schnell

Les images generees sont sauvegardees avec exactement les noms attendus
par seed_sample_data_relevant_images.py :

    <imageKey>-1.jpg
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()



API_KEY = os.getenv("HUGGINGFACE_API_KEY")

DEFAULT_MODEL = "black-forest-labs/FLUX.1-Krea-dev"
API_BASE_URL = "https://router.huggingface.co/hf-inference/models"

# Style commun ajoute a chaque prompt afin d'obtenir un rendu coherent.
COMMON_STYLE = """
Photographie realiste de petite annonce entre etudiants en Suisse.
L'objet annonce est clairement visible et occupe une place importante dans l'image.
Objet d'occasion reel et crediblement photographie.
Eclairage naturel, environnement simple et realiste, composition propre.
Photo style smartphone ou appareil photo, haute qualite.
Format paysage approximativement 4:3.
Sans texte ajoute, sans watermark, sans collage, sans illustration, sans rendu 3D.
""".strip()


IMAGES = [
    {
        "filename": "calculatrice-hp-prime-g2-1.jpg",
        "prompt": """
Une calculatrice graphique moderne noire de type HP Prime G2 posee sur un bureau
d'etudiant en bois clair. Ecran visible mais sans informations personnelles.
Un cable USB et une petite housse noire sont poses a cote. Quelques cahiers de
mathematiques flous en arriere-plan. Ambiance universitaire.
""",
    },
    {
        "filename": "analyse-1-recueil-exercices-1.jpg",
        "prompt": """
Un recueil universitaire de mathematiques ouvert sur une table d'etudiant.
Des exercices de calcul, integrales et graphiques sont visibles mais aucun texte
precis n'est lisible. Quelques annotations discretes au crayon. Cahier et stylo
a cote, ambiance de salle d'etude.
""",
    },
    {
        "filename": "bureau-ikea-micke-1.jpg",
        "prompt": """
Un petit bureau blanc moderne de style IKEA Micke dans une chambre d'etudiant.
Plateau propre presque vide, un tiroir visible, deux legeres rayures naturelles
sur le plateau. Une chaise simple devant le bureau. Interieur etudiant credible.
""",
    },
    {
        "filename": "kit-arduino-uno-1.jpg",
        "prompt": """
Un kit Arduino Uno complet pose sur une table : carte Arduino Uno, breadboard,
resistances, LED, petits capteurs, cables Dupont et deux petits servomoteurs.
Composants utilises mais propres, boite de rangement visible. Bureau d'etudiant
en ingenierie ou laboratoire universitaire.
""",
    },
    {
        "filename": "nespresso-inissia-1.jpg",
        "prompt": """
Une petite machine a cafe compacte de style Nespresso Inissia posee sur un plan
de travail de cuisine d'etudiant. Bac a capsules visible et quelques capsules
posees a cote. Machine propre, legerement utilisee. Cuisine moderne et simple.
""",
    },
    {
        "filename": "raquette-badminton-yonex-1.jpg",
        "prompt": """
Une raquette de badminton moderne posee sur un banc de gymnase, avec sa housse
a cote et un tube de volants en plastique ouvert. Quelques volants visibles.
Materiel legerement utilise mais en bon etat.
""",
    },
    {
        "filename": "blouse-laboratoire-1.jpg",
        "prompt": """
Une blouse blanche de laboratoire propre suspendue a un cintre dans un
environnement universitaire. Tissu en coton legerement froisse, sans taches
ni brulures. Photo de vetement d'occasion realiste.
""",
    },
    {
        "filename": "lampe-bureau-led-1.jpg",
        "prompt": """
Une lampe de bureau LED moderne articulee posee sur un bureau d'etudiant.
Bras articule clairement visible, lampe allumee avec une lumiere blanche douce.
Ordinateur portable et cahier flous en arriere-plan. Ambiance de travail du soir.
""",
    },
    {
        "filename": "ecran-dell-24-1.jpg",
        "prompt": """
Un ecran informatique noir de 24 pouces de style Dell pose sur un bureau.
Ecran allume avec un fond abstrait simple sans texte. Pied reglable visible,
cable HDMI pose a cote. Bureau d'etudiant propre et realiste.
""",
    },
    {
        "filename": "clean-code-robert-martin-1.jpg",
        "prompt": """
Un livre de programmation informatique a couverture verte de style manuel
technique, pose sur un bureau de developpeur etudiant. Couverture legerement
usee, ordinateur portable et clavier flous en arriere-plan.
Ne pas reproduire exactement une couverture de livre existante ni de texte lisible.
""",
    },
    {
        "filename": "chaise-bureau-1.jpg",
        "prompt": """
Une chaise de bureau ergonomique a roulettes avec dossier en resille noire,
accoudoirs visibles et assise legerement usee. Dans une chambre ou un bureau
d'etudiant simple et realiste.
""",
    },
    {
        "filename": "multimetre-pinces-1.jpg",
        "prompt": """
Un multimetre numerique pose sur une table de laboratoire electronique.
Sondes rouge et noire visibles et plusieurs pinces crocodiles a cote.
Ecran affichant une valeur simple non personnelle. Materiel legerement utilise.
""",
    },
    {
        "filename": "bouilloire-electrique-1.jpg",
        "prompt": """
Une bouilloire electrique en inox de 1.7 litre posee sur un plan de travail
de cuisine. Poignee et bec verseur visibles, petite tasse a cote. Cuisine de
colocation etudiante, bouilloire propre mais utilisee.
""",
    },
    {
        "filename": "tapis-yoga-1.jpg",
        "prompt": """
Un tapis de yoga antiderapant roule ou legerement deroule sur un sol en bois.
Une sangle de transport est posee a cote. Tapis propre et legerement utilise,
interieur d'etudiant moderne et simple.
""",
    },
    {
        "filename": "guirlande-lumineuse-1.jpg",
        "prompt": """
Une guirlande lumineuse LED blanche chaude installee autour d'une etagere ou
d'un mur dans une chambre d'etudiant. Ambiance chaleureuse en soiree,
petites lumieres visibles, chambre simple et credible.
""",
    },
    {
        "filename": "cables-adaptateurs-1.jpg",
        "prompt": """
Un lot de cables et adaptateurs electroniques disposes naturellement sur un
bureau : cables USB-C, HDMI, jack audio 3.5 mm et adaptateur VGA visibles.
Materiel propre, legerement utilise, presentation naturelle de petite annonce.
""",
    },
    {
        "filename": "physique-halliday-resnick-1.jpg",
        "prompt": """
Un gros manuel universitaire de physique pose sur une table d'etude.
Couverture legerement utilisee, cahier de physique et feuilles a cote.
Livre ouvert avec quelques passages discretement surlignes mais aucun texte
precis lisible.
""",
    },
    {
        "filename": "etagere-kallax-2x2-1.jpg",
        "prompt": """
Une petite etagere blanche carree avec quatre compartiments de style Kallax 2x2,
placee dans une chambre d'etudiant. Presque vide, un leger eclat naturel sur
un angle, meuble d'occasion realiste.
""",
    },
    {
        "filename": "dessin-technique-1.jpg",
        "prompt": """
Un ensemble de dessin technique pose sur une table : deux equerres transparentes,
rapporteur, compas de precision et porte-mines, materiel range dans un etui
rigide ouvert. Environnement d'etudiant en ingenierie.
""",
    },
    {
        "filename": "veste-polaire-1.jpg",
        "prompt": """
Une veste polaire noire taille adulte suspendue sur un cintre.
Poches zippees visibles, tissu legerement utilise mais propre, chambre
d'etudiant simple en arriere-plan.
""",
    },
    {
        "filename": "casque-audio-1.jpg",
        "prompt": """
Un casque audio circum-aural filaire avec arceau pose sur un bureau.
Cable detachable visible, coussinets legerement uses, ordinateur portable
flou en arriere-plan. Environnement etudiant.
""",
    },
    {
        "filename": "vaisselle-colocation-1.jpg",
        "prompt": """
Un lot de vaisselle d'occasion dispose sur une table de cuisine : plusieurs
assiettes, bols, couverts legerement depareilles et deux casseroles.
Tous les elements clairement visibles. Cuisine de colocation etudiante.
""",
    },
    {
        "filename": "velo-ville-1.jpg",
        "prompt": """
Un velo de ville legerement ancien stationne dans un parking a velos.
Cadre en bon etat, pneus legerement degonfles, cables de frein visibles et
legerement uses. Velo entier visible dans un environnement urbain suisse realiste.
""",
    },
    {
        "filename": "sac-a-dos-ordinateur-1.jpg",
        "prompt": """
Un sac a dos noir ou gris pour ordinateur portable de 15 pouces pose debout.
Compartiment rembourre legerement ouvert et visible, deux poches laterales,
tissu legerement delave mais en bon etat. Environnement etudiant.
""",
    },
    {
        "filename": "introduction-bases-donnees-1.jpg",
        "prompt": """
Un manuel universitaire moderne consacre aux bases de donnees pose sur un bureau.
Pages ouvertes montrant des diagrammes abstraits et schemas relationnels sans
texte lisible. Ordinateur portable flou en arriere-plan. Livre neuf et propre.
""",
    },
    {
        "filename": "fer-a-souder-1.jpg",
        "prompt": """
Un fer a souder de 30 watts pose dans son support metallique, petite eponge
a cote et bobine d'etain entamee visible. Etabli ou table de laboratoire
electronique, materiel legerement utilise mais propre.
""",
    },
    {
        "filename": "matelas-simple-90x200-1.jpg",
        "prompt": """
Un matelas simple blanc de 90x200 cm propre pose sur un lit simple dans une
petite chambre d'etudiant. Housse propre et lavee, aucune tache visible.
Interieur simple et realiste.
""",
    },
    {
        "filename": "chaussures-securite-43-1.jpg",
        "prompt": """
Une paire de chaussures de securite noires avec coque renforcee posee cote a cote
sur un sol propre. Lacets visibles, semelles legerement utilisees mais en tres
bon etat. Environnement d'atelier universitaire.
""",
    },
    {
        "filename": "disque-dur-externe-500go-1.jpg",
        "prompt": """
Un disque dur externe portable noir de 2.5 pouces pose sur un bureau.
Cable USB 3.0 visible a cote, ordinateur portable flou en arriere-plan.
Materiel propre et legerement utilise.
""",
    },
    {
        "filename": "plantes-vertes-lot-1.jpg",
        "prompt": """
Trois petites plantes d'interieur posees ensemble pres d'une fenetre :
un pothos, un petit cactus et une petite succulente. Chaque plante dans un
pot different. Plantes en bonne sante, appartement etudiant lumineux.
""",
    },
]


def generate_image(model: str, prompt: str, timeout: int = 180) -> bytes:
    """Appelle Hugging Face Inference API et retourne directement les octets image."""
    url = f"{API_BASE_URL}/{model}"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "image/jpeg",
        "Content-Type": "application/json",
    }

    payload = {
        "inputs": f"{COMMON_STYLE}\n\nObjet a generer :\n{prompt}",
    }

    response = requests.post(
        url,
        headers=headers,
        json=payload,
        timeout=timeout,
    )

    content_type = response.headers.get("content-type", "")

    if response.status_code != 200:
        try:
            error = response.json()
        except ValueError:
            error = response.text[:500]

        raise RuntimeError(
            f"API Hugging Face HTTP {response.status_code}: {error}"
        )

    if not content_type.startswith("image/"):
        raise RuntimeError(
            f"L'API n'a pas retourne une image ({content_type}) : "
            f"{response.text[:500]}"
        )

    return response.content


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genere les images pertinentes des annonces HEIG-Echange."
    )
    parser.add_argument(
        "--output-dir",
        default="sample-images",
        help="Dossier de sortie (defaut : sample-images)",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Modele Hugging Face (defaut : {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Ne pas regenerer les fichiers deja presents.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delai entre deux generations en secondes (defaut : 1).",
    )
    args = parser.parse_args()

    if not API_KEY:
        print(
            "ERREUR : HUGGINGFACE_API_KEY est introuvable.\n\n"
            "Creez un fichier .env avec :\n"
            "HUGGINGFACE_API_KEY=hf_votre_cle\n",
            file=sys.stderr,
        )
        return 1

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Modele : {args.model}")
    print(f"Dossier : {output_dir.resolve()}")
    print(f"Images a traiter : {len(IMAGES)}\n")

    generated = 0
    skipped = 0
    failed = []

    for index, image in enumerate(IMAGES, start=1):
        filename = image["filename"]
        destination = output_dir / filename

        if args.skip_existing and destination.exists():
            print(f"[{index:02}/{len(IMAGES)}] SKIP {filename}")
            skipped += 1
            continue

        print(f"[{index:02}/{len(IMAGES)}] Generation : {filename}")

        try:
            image_bytes = generate_image(args.model, image["prompt"])
            destination.write_bytes(image_bytes)
            print(f"         OK -> {destination}")
            generated += 1

        except requests.Timeout:
            print("         ERREUR : timeout", file=sys.stderr)
            failed.append(filename)

        except requests.RequestException as exc:
            print(f"         ERREUR reseau : {exc}", file=sys.stderr)
            failed.append(filename)

        except Exception as exc:
            print(f"         ERREUR : {exc}", file=sys.stderr)
            failed.append(filename)

        if index < len(IMAGES):
            time.sleep(args.delay)

    print("\n==============================")
    print(f"Generation terminee")
    print(f"  Generees : {generated}")
    print(f"  Ignorees : {skipped}")
    print(f"  Echecs   : {len(failed)}")

    if failed:
        print("\nImages en erreur :")
        for filename in failed:
            print(f"  - {filename}")

        print(
            "\nVous pouvez relancer avec :\n"
            f"  python3 {Path(__file__).name} "
            f"--output-dir {output_dir} --skip-existing"
        )
        return 1

    print(
        "\nToutes les images sont presentes. Vous pouvez maintenant lancer :\n"
        f"  python3 scripts/seed_sample_data_relevant_images.py "
        f"--photos-dir {output_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
