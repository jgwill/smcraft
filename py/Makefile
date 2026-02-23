.PHONY: install test build dist sdist bdist_wheel upload upload-test bump clean

install:
	pip install -e .

test:
	pytest

build:
	python -m build

dist: build
	@echo "Distribution created in dist/"

sdist:
	python -m build --sdist

bdist_wheel:
	python -m build --wheel

upload: build
	twine upload dist/*

upload-test: build
	twine upload --repository testpypi dist/*

bump:
	python bump.py

clean:
	rm -rf build/ dist/ *.egg-info **/*.egg-info .pytest_cache/