const express = require('express');
const sql = require('mssql');
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());

// Ensure the 'uploads' directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

// Initialize multer with the storage configuration
const upload = multer({ storage: storage });



app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const dbConfig = {
    user: 'scsit_qa2',
    password: 'adgft12365@##',
    server: '10.10.152.16',
    port: 1433,
    database: 'z_scope',
    options: {
        // Use encryption if needed
        trustServerCertificate: true  // Disable certificate validation (in production, make sure to enable it)
    },
    requestTimeout: 100000,
    connectionTimeOut: 30000
};

let selectedBrandId = null;

app.get('/api/getBrands', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const recordset = await pool.request().query('SELECT distinct(Brand),brandid FROM locationinfo');

        //console.log("brands",recordset.recordsets);

        res.status(200).json(
            recordset.recordset

        );
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching dropdown data');
    }
});

app.post('/api/selectBrand', async (req, res) => {
    try {
        const { brandId } = req.body;  // Get the selected brandId from the frontend

        if (!brandId) {
            return res.status(400).send('BrandId is required');
        }

        // If you're performing any additional operations (like database queries), do it here
        console.log(`Selected BrandId: ${brandId}`);

        selectedBrandId = brandId;  // Now you can reassign the value of selectedBrandId

        // If needed, you can do other operations, e.g., store it in a database or session.

        res.status(200).send('Brand selected successfully');
    } catch (error) {
        console.error('Error in /api/selectBrand:', error);  // Log the error for debugging
        res.status(500).send('Internal Server Error');
    }
});


// Endpoint to fetch categories
app.get('/api/getCategories', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Query to select distinct categories from the part_Master table
        const categoriesResult = await pool.request().query('SELECT distinct(Category) FROM part_Master');
        
        // Send the response with the list of categories
        res.status(200).json(categoriesResult.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching categories');
    }
});

app.post('/api/executeDeleteQuery', async (req, res) => {
    try {
        const { brandId } = req.body;  // Get the selected brandId from the frontend

        if (!brandId) {
            return res.status(400).json({ success: false, message: 'BrandId is required' });
        }

        // Perform the delete query
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('brandId', sql.Int, brandId)
            .query('DELETE FROM dealer_task_monitor WHERE brandid = @brandId');

        console.log(`Deleted records where brandId = ${brandId}`);

        res.status(200).json({ success: true, message: 'Data deleted successfully' });
    } catch (error) {
        console.error('Error in /api/executeDeleteQuery:', error);  // Log the error for debugging
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});


// Handle file upload and data insertion into the database
app.post('/api/uploadFile', upload.single('file'), async (req, res) => {
    try {
        if (!selectedBrandId) {
            return res.status(400).send('BrandId is required');
        }

        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        const filePath = path.join(__dirname, 'uploads', req.file.filename);
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        console.log(data);
        const pool = await sql.connect(dbConfig);

        for (let row of data) {
            const {
                BRAND, DEALER, LOCATION, CATEGORY, STATUS, SALETYPE, MAX_CONSIGNEE, 'Mother Name In case Of Child': MOTHER_NAME
            } = row;

            // Query to get dealerid and locationid from locationinfo table
            const locationQuery = `
             SELECT dealerid, locationid 
             FROM locationinfo 
             WHERE brand = @brand AND dealer = @dealer AND location = @location
         `;


            const locationResult = await pool.request()
                .input('brand', sql.NVarChar, BRAND)
                .input('dealer', sql.NVarChar, DEALER)
                .input('location', sql.NVarChar, LOCATION)
                .query(locationQuery);

            if (locationResult.recordset.length > 0) {
                const dealerid = locationResult.recordset[0].dealerid;
                const locationid = locationResult.recordset[0].locationid;
                await pool.request()

                    .input('brandId', sql.Int, selectedBrandId)
                    .input('dealerid', sql.Int, dealerid)
                    .input('locationid', sql.Int, locationid)
                    .input('brand', sql.NVarChar, BRAND)
                    .input('dealer', sql.NVarChar, DEALER)
                    .input('location', sql.NVarChar, LOCATION)
                    .input('category', sql.NVarChar, CATEGORY)
                    .input('status', sql.NVarChar, STATUS)
                    .input('saleType', sql.NVarChar, SALETYPE)
                    .input('maxConsignee', sql.NVarChar, MAX_CONSIGNEE)
                    .input('motherName', sql.NVarChar, MOTHER_NAME)
                    .query(`
                    INSERT INTO dealer_task_monitor (brand,dealer, location, brandid,category, status, saletype, max_consignee, [Mother Name In case Of Child], dealerid, locationid)
                    VALUES (@brand,@dealer, @location, @brandId,@category, @status, @saleType, @maxConsignee, @motherName, @dealerid, @locationid)
                `);

            }
            else {
                console.log(`No matching dealer/location found for ${DEALER} - ${LOCATION}`);
            }
        }

        fs.unlinkSync(filePath);
        res.status(200).send('File uploaded and data inserted successfully');
    } catch (error) {
        console.error('Error in /api/uploadFile:', error);
        res.status(500).send('Internal Server Error');
    }
});


app.post('/api/runDatewiseProcedure', async (req, res) => {
    try {
        const { brandId ,category} = req.body;
        
        if (!brandId || ! category) {
            return res.status(400).send('Brand and category are required');
        }

        const pool = await sql.connect(dbConfig);
        
        // Execute the Daewise procedure
        const result = await pool.request()
            .input('brandId', sql.Int, brandId)
            .input('param2', sql.Int, null)  // Placeholder for the second parameter (if required)
            .input('param3', sql.NVarChar, category)  // Placeholder for the third parameter
            .query('EXEC UAD_Max_Automation @brandId, @param2, @param3');
            console.log('Datewise procedure executed for brandId:', brandId, 'and category:', category);

        res.status(200).send('Datewise procedure executed successfully');
    } catch (error) {
        console.error('Error in /api/runDatewiseProcedure:', error);
        res.status(500).send('Error executing Daewise procedure');
    }
});


app.post('/api/runBlockwiseProcedure', async (req, res) => {
    try {
        const { brandId, category } = req.body;
        
        if (!brandId|| category) {
            return res.status(400).send('BrandId and category are required');
        }

        const pool = await sql.connect(dbConfig);
        
        // Execute the Blockwise procedure
        const result = await pool.request()
            .input('brandId', sql.Int, brandId)
            .input('param2', sql.Int, null)  // Placeholder for the second parameter (if required)
            .input('param3', sql.NVarChar, category)  // Placeholder for the third parameter
            .query('EXEC UAD_Max_Automation_BLOCK @brandId, @param2, @param3');

        console.log('Blockwise procedure executed for brandId:', brandId);

        res.status(200).send('Blockwise procedure executed successfully');
    } catch (error) {
        console.error('Error in /api/runBlockwiseProcedure:', error);
        res.status(500).send('Error executing Blockwise procedure');
    }
});
// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
