# lezec.cz scraper

## 1. Příprava prostředí

Přejmenujte .env.example na .env:

```
mv .env.example .env
```

Upravte přihlašovací údaje v .env:

```
LEZEC_USER=tvuj_login
LEZEC_PASS=tvoje_tajne_heslo
```

## 2. Instalace závislostí

```
yarn
```

## 3. Spuštění

Stáhnout všechny přelezy do climbs.json:

```
yarn dev
```

## 4. Volitelné parametry

```
--offset=N – přeskočí prvních N výsledků

--limit=M – stáhne maximálně M výsledků

--route-info – načte navíc z detailu cesty sector a location (Sektor, Poloha)
```

Příklady:

Stáhnout jen prvních 50 přelezů:

```
yarn dev --limit=50
```

Stáhnout od 100. přelezu do konce:

```
yarn dev --offset=100
```

Stáhnout 20 přelezů od 50. a přidat sektor a polohu:

```
yarn dev --offset=50 --limit=20 --route-info
```

## 5. Výstup

```
climbs.json – základní export (datum, cesta, oblast, klasifikace, styl, body)

climbs_with_crag.json – pokud použijete --route-info, přidají se sector a location
```

## 6. Ukázkový JSON výstup

Bez `--route-info` (`climbs.json`):

```
{
  "date": "07.09.2025",
  "route": "Muffengang R2",
  "area": "Frankenjura",
  "originGrade": "6-",
  "points": "372",
  "style": "OS",
  "routeKey": "27957"
}
```

S `--route-info` (`climbs_with_crag.json`):

```
{
  "date": "07.09.2025",
  "route": "Muffengang R2",
  "area": "Frankenjura",
  "originGrade": "6-",
  "points": "372",
  "style": "OS",
  "routeKey": "27957",
  "sector": "Weissenstein",
  "location": "Německo - Bavorsko"
}
```
