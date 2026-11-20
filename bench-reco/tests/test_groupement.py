"""Le regroupement ne doit jamais couper une fraction, un exposant ou une somme avec ses bornes."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "samples"))

import synth  # noqa: E402
from benchreco.config import Config  # noqa: E402
from benchreco.feuille import Trait, estimer_hauteur  # noqa: E402
from benchreco.groupement import regrouper  # noqa: E402

CFG = Config.charger()


def traits_de(feuille: dict) -> list[Trait]:
    out = []
    for k, t in enumerate(feuille["traits"]):
        a = np.array(t["points"], float)
        out.append(Trait(k, t["id"], "#000", 2.0, a[:, :2], a[:, 2], t["debut"] / 1000, t["fin"] / 1000))
    return out


def groupes_pour(lignes, taille=40.0, graine=1):
    feuille, etiq = synth.vers_feuille(lignes, taille, graine)
    traits = traits_de(feuille)
    h = estimer_hauteur(traits, CFG.echelle.centile)
    return regrouper(traits, CFG.groupement, h), etiq, h


def verifie_partition(groupes, etiq, nb_lignes):
    """Chaque ligne = exactement un groupe, et aucun groupe ne mélange deux lignes."""
    reels = [g for g in groupes if not g.bruit]
    assert len(reels) == nb_lignes, [(g.id, sorted({etiq[i] for i in g.indices})) for g in reels]
    for g in reels:
        assert len({etiq[i] for i in g.indices}) == 1


@pytest.mark.parametrize("taille", [28.0, 40.0, 70.0])
@pytest.mark.parametrize("graine", [1, 2, 3])
def test_exemple_complet(taille, graine):
    lignes = [b for b, _ in synth.exemple(taille)]
    groupes, etiq, _ = groupes_pour(lignes, taille, graine)
    verifie_partition(groupes, etiq, len(lignes))


def test_fraction_pas_coupee():
    t = 40.0
    f = synth.hcat(synth.fraction(synth.texte("x+1", 0.8 * t), synth.texte("2", 0.8 * t), t), synth.texte("=3", t), ecart=0.25 * t)
    groupes, etiq, _ = groupes_pour([f], t)
    verifie_partition(groupes, etiq, 1)
    assert "fraction" in groupes[0].structures


def test_fraction_imbriquee():
    t = 40.0
    interne = synth.fraction(synth.texte("1", 0.6 * t), synth.texte("x", 0.6 * t), 0.8 * t)
    f = synth.fraction(synth.texte("1", 0.8 * t), synth.hcat(synth.texte("2+", 0.8 * t), interne, ecart=0.15 * t), t)
    groupes, etiq, _ = groupes_pour([f], t)
    verifie_partition(groupes, etiq, 1)


def test_exposants_et_indices():
    t = 40.0
    p = 0.65 * t
    ligne = synth.hcat(
        synth.exposant(synth.texte("x", t), synth.texte("2", p), t),
        synth.indice(synth.texte("y", t), synth.texte("1", p), t),
        ecart=0.25 * t,
    )
    groupes, etiq, _ = groupes_pour([ligne], t)
    verifie_partition(groupes, etiq, 1)


def test_somme_avec_bornes():
    t = 40.0
    p = 0.65 * t
    s = synth.hcat(synth.grand_symbole("∑", synth.texte("10", p), synth.texte("x=1", p), t), synth.texte("x", t), ecart=0.25 * t)
    groupes, etiq, _ = groupes_pour([s], t)
    verifie_partition(groupes, etiq, 1)


def test_deux_lignes_serrees_restent_separees():
    t = 40.0
    lignes = [synth.texte("12+3x=7", t), synth.texte("4y-5=9", t), synth.texte("x+y=2", t)]
    groupes, etiq, _ = groupes_pour(lignes, t)
    verifie_partition(groupes, etiq, 3)


def test_deux_expressions_eloignees_sur_une_ligne():
    t = 40.0
    big = synth.hcat(synth.texte("x=1", t), synth.Boite([], 9 * t), synth.texte("y=2", t))  # 9 t de blanc
    groupes, etiq, _ = groupes_pour([big], t)
    assert len([g for g in groupes if not g.bruit]) == 2


def test_ordre_de_lecture():
    t = 40.0
    lignes = [synth.texte("11", t), synth.texte("22", t), synth.texte("33", t)]
    groupes, etiq, _ = groupes_pour(lignes, t)
    assert [etiq[g.indices[0]] for g in groupes] == [0, 1, 2]
    assert [g.id for g in groupes] == ["G1", "G2", "G3"]
