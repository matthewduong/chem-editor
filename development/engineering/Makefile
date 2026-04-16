TEX = engineering.tex
PDF = engineering.pdf
LATEXMK = latexmk
PDFLATEX = pdflatex

.PHONY: all clean

all: $(PDF)

# Prefer latexmk if available (handles re-runs automatically), fall back to two pdflatex passes
$(PDF): $(TEX)
	@if command -v $(LATEXMK) >/dev/null 2>&1; then \
		$(LATEXMK) -pdf -interaction=nonstopmode $(TEX); \
	else \
		$(PDFLATEX) -interaction=nonstopmode $(TEX); \
		$(PDFLATEX) -interaction=nonstopmode $(TEX); \
	fi

clean:
	$(LATEXMK) -C 2>/dev/null || rm -f \
		engineering.aux engineering.log engineering.out \
		engineering.toc engineering.fls engineering.fdb_latexmk \
		engineering.pdf
