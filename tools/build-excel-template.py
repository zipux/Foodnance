"""Builds public/downloads/food-cost-calculator.xlsx, the free template offered
on /food-cost-calculator-excel.

Not part of the app or the build: run it by hand when the template changes.
Needs openpyxl (python3 -m pip install openpyxl):

    python3 tools/build-excel-template.py

The cell positions are quoted on the page (H12 = cost of the dish, H13 =
portions, ...) and checked by tests/food-cost-excel-page.test.mjs, so move a
row here and the page and the test move with it. The unit factors are the ones
in public/static/food-cost-calculator.js (the ounce is exactly a sixteenth of a pound).
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'downloads', 'food-cost-calculator.xlsx')

UNITS = [  # name, how many of the base unit (g / ml / each), kind
    ('g', 1, 'weight'), ('kg', 1000, 'weight'), ('oz', 28.349523125, 'weight'), ('lb', 453.59237, 'weight'),
    ('ml', 1, 'volume'), ('L', 1000, 'volume'), ('each', 1, 'count'),
]
FIRST, LAST = 2, 11          # ingredient rows
U = f"Units!$A$2:$C${len(UNITS) + 1}"

HEAD = PatternFill('solid', fgColor='0369A1')
CALC = PatternFill('solid', fgColor='E0F2FE')
LINE = Side(style='thin', color='D6D3CB')
BOX = Border(left=LINE, right=LINE, top=LINE, bottom=LINE)
MONEY, PCT = '"$"#,##0.00', '0.0%'

wb = Workbook()
ws = wb.active
ws.title = 'Dish'

for col, (title, width) in enumerate([('Ingredient', 26), ('Paid', 12), ('Bought', 10), ('Unit', 8),
                                      ('Usable %', 10), ('Used', 10), ('Unit', 8), ('Cost', 14)], start=1):
    c = ws.cell(row=1, column=col, value=title)
    c.font, c.fill, c.border = Font(bold=True, color='FFFFFF'), HEAD, BOX
    c.alignment = Alignment(horizontal='left' if col in (1, 4, 7) else 'right')
    ws.column_dimensions[c.column_letter].width = width

EXAMPLE = {2: ('Beef', 300, 10, 'kg', 1, 300, 'g'), 3: ('Potatoes', 32, 5, 'kg', 1, 200, 'g')}
for r in range(FIRST, LAST + 1):
    for col, v in enumerate(EXAMPLE.get(r, (None,) * 7), start=1):
        ws.cell(row=r, column=col, value=v).border = BOX
    ws.cell(row=r, column=2).number_format = MONEY
    ws.cell(row=r, column=5).number_format = '0%'
    cost = ws.cell(row=r, column=8, value=(
        f'=IF(OR(B{r}="",C{r}="",F{r}=""),"",'
        f'IF(VLOOKUP(D{r},{U},3,FALSE)<>VLOOKUP(G{r},{U},3,FALSE),"Check units",'
        f'B{r}/(C{r}*IF(E{r}="",1,E{r}))*F{r}*VLOOKUP(G{r},{U},2,FALSE)/VLOOKUP(D{r},{U},2,FALSE)))'))
    cost.number_format, cost.fill, cost.border = MONEY, CALC, BOX
    cost.alignment = Alignment(horizontal='right')

pick = DataValidation(type='list', formula1='"' + ','.join(u[0] for u in UNITS) + '"', allow_blank=True)
pick.error, pick.errorTitle = 'Pick a unit from the list.', 'Unit'
ws.add_data_validation(pick)
pick.add(f'D{FIRST}:D{LAST}')
pick.add(f'G{FIRST}:G{LAST}')

# label, value or formula, number format, worked out (blue) or typed (white)
SUMMARY = [
    (12, 'Cost of the dish', f'=SUM(H{FIRST}:H{LAST})', MONEY, True),
    (13, 'Portions', 1, '0', False),
    (14, 'Cost per portion', '=IF(H13>0,H12/H13,"")', MONEY, True),
    (15, 'Selling price', 34, MONEY, False),
    (16, 'Food cost', '=IF(AND(ISNUMBER(H14),H15>0),H14/H15,"")', PCT, True),
    (17, 'Gross profit per portion', '=IF(AND(ISNUMBER(H14),H15>0),H15-H14,"")', MONEY, True),
    (18, 'Target food cost', 0.3, '0%', False),
    (19, 'Price needed for the target', '=IF(AND(ISNUMBER(H14),H18>0),H14/H18,"")', MONEY, True),
]
for r, label, value, fmt, worked_out in SUMMARY:
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7)
    a = ws.cell(row=r, column=1, value=label)
    a.font = Font(bold=worked_out)
    h = ws.cell(row=r, column=8, value=value)
    h.number_format, h.border, h.font = fmt, BOX, Font(bold=worked_out)
    h.alignment = Alignment(horizontal='right')
    if worked_out:
        h.fill = CALC

ws['A21'] = 'White cells are yours to fill in. Blue cells are worked out for you.'
ws['A22'] = 'The beef and potatoes are an example. Type over them with your own dish.'
ws['A23'] = 'Usable % is the share you serve after trimming or cooking. Leave it empty for 100%.'
ws['A24'] = '"Check units" means a weight was matched with a volume. Use the same kind on both sides.'
ws['A26'] = 'Made by Foodnance, food cost software that reads your supplier invoices.'
ws['A27'] = 'foodnance.com/food-cost-calculator-excel'
ws['A27'].hyperlink = 'https://foodnance.com/food-cost-calculator-excel'
ws['A27'].font = Font(color='0369A1', underline='single')
for r in (21, 22, 23, 24, 26):
    ws.cell(row=r, column=1).font = Font(color='6B6659')
ws.freeze_panes = 'A2'

us = wb.create_sheet('Units')
for col, title in enumerate(('Unit', 'In grams, millilitres or pieces', 'Kind'), start=1):
    us.cell(row=1, column=col, value=title).font = Font(bold=True)
for r, row in enumerate(UNITS, start=2):
    for col, v in enumerate(row, start=1):
        us.cell(row=r, column=col, value=v)
us.column_dimensions['A'].width, us.column_dimensions['B'].width, us.column_dimensions['C'].width = 8, 32, 10
us['A10'] = 'The Dish sheet reads this table. Add a line here to add a unit, then type its name on the Dish sheet.'
us['A10'].font = Font(color='6B6659')

wb.properties.title = 'Food cost calculator'
wb.properties.creator = 'Foodnance'
wb.save(OUT)
print('wrote', os.path.normpath(OUT))
