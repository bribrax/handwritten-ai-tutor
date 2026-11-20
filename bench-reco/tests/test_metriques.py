import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchreco.metriques import comparer, normaliser  # noqa: E402


def test_equivalences_latex():
    assert normaliser(r"\left( x^{2} \right)") == normaliser("(x^2)")
    assert normaliser(r"\dfrac{1}{2}") == normaliser(r"\frac{1}{2}")
    assert normaliser(r"x_{i} \, + y") == normaliser("x_i+y")
    assert comparer(r"\frac{a}{b}", r"\dfrac{a}{b}").exact


def test_erreurs_comptees():
    s = comparer("x^2+1", "x^2+7")
    assert not s.exact and s.distance == 1 and 0 < s.cer < 1
    assert comparer("", "abc").cer == 1.0


def test_delimiteurs_d_affichage_ignores():
    assert normaliser(r"\[x^2+1\]") == normaliser("x^2+1")
    assert normaliser("$$ x^2+1 $$") == normaliser("x^2+1")
    assert normaliser("$x^2+1$") == normaliser("x^2+1")
    assert comparer(r"\[\frac{1}{2}\]", r"\frac{1}{2}").exact
