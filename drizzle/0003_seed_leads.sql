-- Seed data: the 24 Phoenix-metro HVAC/plumbing leads from the September 2026
-- cold-outreach campaign (Resend broadcast, groups A and B). Backs the
-- outreach map on /admin. contacted_at is approximate (the campaign send date);
-- adjust if you have exact per-lead send timestamps.
INSERT INTO "leads" (business_name, email, industry, address, city, state, lat, lng, outreach_group, contacted_at) VALUES
  ('Farrell Mechanical', 'farrellmechanicalaz@gmail.com', 'hvac', 'Farrell Mechanical, Chandler, AZ 85286', 'Chandler', 'AZ', 33.3062031, -111.841185, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Abide Air Conditioning', 'abideairconditioning@gmail.com', 'hvac', 'Abide Air Conditioning, Glendale, AZ', 'Glendale', 'AZ', 33.5386858, -112.185994, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Sundance Air Heating & Cooling', 'robert@sundanceaz.com', 'hvac', '19801 N 59th Ave, Glendale, AZ', 'Glendale', 'AZ', 33.6657865, -112.1854986, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('TSC Air', 'info@tscair.com', 'hvac', '1022 W 23rd St, Tempe, AZ', 'Tempe', 'AZ', 33.4040403, -111.9539037, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Larson Air Conditioning', 'marketing@larsonairaz.com', 'hvac', '7363 E Adobe Dr, Scottsdale, AZ 85255', 'Scottsdale', 'AZ', 33.6861345, -111.9221568, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Local Roots AC & Plumbing', 'service@calllocalroots.com', 'both', '23335 N 18th Dr, Phoenix, AZ', 'Phoenix', 'AZ', 33.69765, -112.0973, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Arid Valley Plumbing', 'contact@aridvalleyaz.com', 'plumbing', '4214 E Downing St, Mesa, AZ', 'Mesa', 'AZ', 33.4289846, -111.7404499, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('No Worries Rooter Plumbing', 'info@noworriesrooter.com', 'plumbing', '195 W San Angelo St, Gilbert, AZ 85233', 'Gilbert', 'AZ', 33.3690675, -111.793655, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('McCabe Plumbing', 'service@mccabeplumbingaz.com', 'plumbing', '22211 S Ellsworth Rd, Queen Creek, AZ 85142', 'Queen Creek', 'AZ', 33.2466668, -111.6342379, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Scottsdale Plumbing', 'info@scottsdaleplumbing.com', 'plumbing', '7112 E Main St, Scottsdale, AZ', 'Scottsdale', 'AZ', 33.4932042, -111.9279066, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Second Opinion Plumbing', '2ndopllc@gmail.com', 'plumbing', '410 E Scott Ave, Gilbert, AZ', 'Gilbert', 'AZ', 33.3661835, -111.7814065, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Omnia Plumbing', 'mike@omniaplumbing.com', 'plumbing', '5602 E Acoma Dr, Scottsdale, AZ 85254', 'Scottsdale', 'AZ', 33.6190158, -111.9600494, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Rooter and Plumbing Service', 'rooterandplumbingservice@outlook.com', 'plumbing', 'Rooter and Plumbing Service, Tempe, AZ', 'Tempe', 'AZ', 33.4255117, -111.940016, '2026-09 Phoenix HVAC/Plumbing — Group A', '2026-09-19 00:00:00+00'),
  ('Ragan''s Heating & Air', 'contact@ragansheatingandair.com', 'both', '3832 W Rene Dr, Chandler, AZ', 'Chandler', 'AZ', 33.3178365, -111.9076808, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('AirZona HVAC Inc.', 'office@airzonahvac.com', 'hvac', '6094 N 57th Ave, Glendale, AZ 85301', 'Glendale', 'AZ', 33.5271937, -112.1822171, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Bumble Bee Air Conditioning and Heating', 'thehive@bumblebeeairconditioning.com', 'hvac', '1004 E Vista Del Cerro Dr, Tempe, AZ', 'Tempe', 'AZ', 33.4102197, -111.9239398, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Accurate Air', 'tom.accurate@gmail.com', 'hvac', '1321 E Weber Dr, Tempe, AZ', 'Tempe', 'AZ', 33.4436045, -111.9170513, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Dependable Air LLC', 'dependableairaz@gmail.com', 'hvac', 'Dependable Air LLC, Mesa, AZ 85206', 'Mesa', 'AZ', 33.4151005, -111.831455, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Apache Plumbing Services', 'apacheplumbing@cox.net', 'plumbing', '6827 N Black Cyn Hwy, Phoenix, AZ', 'Phoenix', 'AZ', 33.5373675, -112.1116257, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Gold Star Plumbing & Drain', 'support@goldstarplumbingaz.com', 'plumbing', '3010 S Potter Dr, Tempe, AZ 85282', 'Tempe', 'AZ', 33.3960407, -111.9727548, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Aurora Plumbing & Mechanical LLC', 'contact@auroraplumbingllc.com', 'plumbing', '9577 W Ross Ave, Peoria, AZ 85382', 'Peoria', 'AZ', 33.6735125, -112.2662185, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Dominick Plumbing', 'info@dominickplumbing.com', 'plumbing', '9375 E Shea Blvd, Scottsdale, AZ', 'Scottsdale', 'AZ', 33.5811624, -111.8787318, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('Cuskic Plumbing', 'cuskicplumbing@gmail.com', 'plumbing', 'Cuskic Plumbing, Glendale, AZ 85306', 'Glendale', 'AZ', 33.5386858, -112.185994, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00'),
  ('DC Family Plumbing', 'devon@dcfamilyplumbing.com', 'plumbing', '1797 W University Dr, Tempe, AZ 85281', 'Tempe', 'AZ', 33.4203829, -111.9688971, '2026-09 Phoenix HVAC/Plumbing — Group B', '2026-09-19 00:00:00+00');
