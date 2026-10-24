from pathlib import Path
import json
from shapely.geometry import shape,mapping
from shapely import make_valid
root=Path(__file__).resolve().parents[1] / 'public'
topology=json.loads((root/'data/world-ind.json').read_text());scale=topology['transform']['scale'];offset=topology['transform']['translate'];decoded=[]
for arc in topology['arcs']:
 x=y=0;points=[]
 for dx,dy in arc:
  x+=dx;y+=dy;points.append([round(x*scale[0]+offset[0],6),round(y*scale[1]+offset[1],6)])
 decoded.append(points)
def ring(indexes):
 out=[]
 for i in indexes:
  arc=decoded[i] if i>=0 else decoded[~i][::-1]
  out.extend(arc if not out else arc[1:])
 if out and out[0]!=out[-1]:out.append(out[0])
 return out
old=json.loads((root/'countries.json').read_text());properties={f['properties']['ISO_A2']:f['properties'] for f in old['features']};features=[]
for g in next(iter(topology['objects'].values()))['geometries']:
 if g['type']=='Polygon':coordinates=[ring(r) for r in g['arcs']]
 elif g['type']=='MultiPolygon':coordinates=[[ring(r) for r in polygon] for polygon in g['arcs']]
 else:continue
 code=g['properties']['ISO_A2'];props=properties.get(code,{'ISO_A2':code,'ADMIN':code});features.append({'type':'Feature','properties':props,'geometry':{'type':g['type'],'coordinates':coordinates}})
(root/'countries.json').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
# Clip native region shapes against the approved national outlines at the affected borders.
outline={f['properties']['ISO_A2']:make_valid(shape(f['geometry'])) for f in features if f['properties']['ISO_A2'] in ['IN','CN','PK']}
regions=json.loads((root/'subdivisions.json').read_text());count=0
for f in regions['features']:
 code=f['properties'].get('iso_3166_2','').split('-')[0]
 if code in outline:
  geometry=make_valid(shape(f['geometry'])).intersection(outline[code]);f['geometry']=mapping(geometry);count+=1
regions['features']=[f for f in regions['features'] if f['geometry']['type'] in ['Polygon','MultiPolygon'] and f['geometry']['coordinates']]
(root/'subdivisions.json').write_text(json.dumps(regions,separators=(',',':')))
print('Approved country outlines',len(features),'clipped regions',count)
