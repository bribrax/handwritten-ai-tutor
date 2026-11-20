"""Plafond de tokens, détection de boucle et empreinte de groupe (fonctions pures, sans modèle)."""
from types import SimpleNamespace

import numpy as np

from benchreco.feuille import Feuille, Trait
from benchreco.reco import motif_repete, plafond_tokens
from pipeline import empreinte

CFG = SimpleNamespace(tokens_base=20, tokens_par_h=2.5, tokens_min=24, tokens_max=400)


def test_plafond_croit_avec_la_largeur_et_reste_borne():
    assert plafond_tokens(0.5, CFG) == 24  # minimum
    assert plafond_tokens(10, CFG) == 45
    assert plafond_tokens(38.5, CFG) == 116  # G25 de feuille_1 : 1 024 tokens produits en boucle
    assert plafond_tokens(1000, CFG) == 400  # maximum, bien sous les 1 024 d'origine


def test_plafond_laisse_1_5x_de_marge_aux_groupes_notes():
    # (largeur / h, tokens réellement produits) relevés sur les groupes notés de feuille_1 et feuille_2
    mesures = [(4.6, 7), (5.9, 19), (6.0, 11), (10.7, 28), (21.3, 37), (29.8, 60), (34.4, 69), (26.3, 47)]
    for w, tokens in mesures:
        assert plafond_tokens(w, CFG) >= 1.5 * tokens, (w, tokens)


def test_boucle_detectee_apres_plus_de_trois_repetitions():
    motif = [11, 12, 13]
    assert motif_repete([5, *motif * 4]) == motif  # 4 copies de suite
    assert motif_repete([5, *motif * 3]) is None  # 3 copies : encore légitime
    assert motif_repete([9, 0, 6, 0, 6, 0, 6, 0, 6]) == [0, 6]  # « , 0 » répété 4 fois


def test_un_token_seul_exige_huit_repetitions():
    assert motif_repete([9] + [7] * 7) is None
    assert motif_repete([9] + [7] * 8) == [7]


def test_lignes_normales_ne_sont_pas_arretees():
    # a b c d e f g h : aucun motif ; a b a b a b (3 copies) : toléré
    assert motif_repete([1, 2, 3, 4, 5, 6, 7, 8]) is None
    assert motif_repete([4, 1, 2, 1, 2, 1, 2]) is None


def _feuille(*traces):
    traits = [Trait(idx=i, id=f"t{i}", couleur="#111", epaisseur=2.0, pts=np.asarray(p, float), pression=np.full(len(p), 0.5), debut=0.0, fin=1.0)
              for i, p in enumerate(traces)]
    return Feuille(traits, 800.0, "blanc", 0)


def test_empreinte_stable_et_sensible_a_la_geometrie():
    f = _feuille([[0, 0], [10, 10]], [[20, 0], [30, 10]])
    assert empreinte(f, [0, 1]) == empreinte(f, [0, 1])
    # arrondi au dixième : le format léger de l'app et l'export complet donnent la même empreinte
    g = _feuille([[0.02, 0.01], [9.98, 10.03]], [[20, 0], [30, 10]])
    assert empreinte(g, [0, 1]) == empreinte(f, [0, 1])
    # un trait déplacé de 1 unité change l'empreinte
    h = _feuille([[0, 0], [10, 10]], [[21, 0], [30, 10]])
    assert empreinte(h, [0, 1]) != empreinte(f, [0, 1])
    # un trait ajouté dans le groupe aussi
    assert empreinte(f, [0]) != empreinte(f, [0, 1])


def test_empreinte_invariante_par_decalage_vertical():
    f = _feuille([[0, 0], [10, 10]], [[20, 0], [30, 10]])
    bas = _feuille([[0, 200.3], [10, 210.3]], [[20, 200.3], [30, 210.3]])  # même ligne, descendue de 200,3
    assert empreinte(bas, [0, 1]) == empreinte(f, [0, 1])
    droite = _feuille([[5, 0], [15, 10]], [[25, 0], [35, 10]])  # décalée à droite : autre ligne
    assert empreinte(droite, [0, 1]) != empreinte(f, [0, 1])
