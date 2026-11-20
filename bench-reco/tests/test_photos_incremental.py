import base64

import serveur
from correction import decrire
from pipeline import GroupeLu


def test_photos_ecrites_et_filtrees(tmp_path):
    png = base64.b64encode(b"\x89PNG-test").decode()
    sorties = serveur._photos({"photos": ["data:image/png;base64," + png, "data:text/html;base64,AA==", "pas une image", 5]}, tmp_path)
    assert [p.name for p in sorties] == ["enonce_1.png"]
    assert sorties[0].read_bytes() == b"\x89PNG-test"


def test_photos_plafonnees(tmp_path):
    jpg = "data:image/jpeg;base64," + base64.b64encode(b"x").decode()
    assert len(serveur._photos({"photos": [jpg] * 10}, tmp_path)) == serveur.PHOTOS_MAX


def test_decrire_marque_les_lignes_inchangees():
    g1 = GroupeLu(id="G1", x0=0, y0=0, x1=1, y1=1, latex="", type_probable="formule", couleur="#111", nb_traits=3, empreinte="a")
    g2 = GroupeLu(id="G2", x0=0, y0=2, x1=1, y1=3, latex="", type_probable="formule", couleur="#111", nb_traits=3, empreinte="b")
    desc = decrire([g1, g2], None, "tout", "bref", "feuille", "image", None, {"G1"})
    assert desc["groupes"][0].get("deja_corrige") is True
    assert "deja_corrige" not in desc["groupes"][1]
