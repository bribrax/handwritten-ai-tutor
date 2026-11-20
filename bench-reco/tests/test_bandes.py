"""Nombre de bandes de la page envoyée à Claude, et coupures qui ne traversent aucun groupe."""
from types import SimpleNamespace

from page_image import coupures, nb_bandes


def g(y0, y1, x0=0.0, x1=100.0, id="G"):
    return SimpleNamespace(id=id, x0=x0, x1=x1, y0=y0, y1=y1)


def test_une_seule_image_pour_une_feuille_courte():
    assert nb_bandes([g(0, 20), g(30, 50)], h=10) == 1


def test_les_feuilles_de_test_donnent_trois_bandes():
    # feuille_3 : ~560 unités, h = 7,1 ; feuille_2 : ~730 unités, h = 11,9 (bande visée : 24 h)
    assert nb_bandes([g(58, 620)], h=7.1) == 3
    assert nb_bandes([g(43, 774)], h=11.9) == 3


def test_le_nombre_de_bandes_est_plafonne():
    assert nb_bandes([g(0, 100000)], h=10, bande_hauteur_h=24, bandes_max=8) == 8


def test_aucune_coupure_ne_traverse_un_groupe():
    groupes = [g(0, 40), g(50, 90), g(100, 140), g(150, 190), g(200, 240), g(250, 290)]
    for n in (2, 3, 4):
        for y in coupures(groupes, n):
            assert not any(gr.y0 < y < gr.y1 for gr in groupes), (n, y)
    assert len(coupures(groupes, 3)) == 2


def test_une_coupure_par_interstice_au_plus():
    # deux groupes seulement : une seule coupure possible même si on demande 4 bandes
    assert len(coupures([g(0, 40), g(60, 100)], 4)) <= 1
