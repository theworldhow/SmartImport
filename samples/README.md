# Sample Data Files

This folder contains sample data files for testing the SmartImport application.

## Files

### input_data.csv
Sample input data file with employee information including:
- first_name, last_name
- email, phone
- date_of_birth, salary
- department

**Usage:** Use as the Input File when creating a new transformation.

### output_sample.csv
Sample output format showing the desired structure:
- FullName (combined first and last name)
- EmailAddress, PhoneNumber
- BirthDate, AnnualSalary
- Dept (department abbreviation)
- EmployeeID

**Usage:** Use as the Output Sample File when creating a new transformation.

### input_reference.txt
Reference documentation for the input data format, including:
- Field descriptions
- Data validation rules
- Format requirements

**Usage:** Use as the Input Reference (optional) to help AI understand input data structure.

### output_reference.txt
Reference documentation for the output data format, including:
- Field descriptions
- Transformation rules
- Validation requirements
- Department mapping rules

**Usage:** Use as the Output Reference (optional) to help AI understand desired output structure and transformations.

## Testing Workflow

1. **New Transformation:**
   - Input File: `input_data.csv`
   - Output Sample File: `output_sample.csv`
   - Input Reference (optional): `input_reference.txt`
   - Output Reference (optional): `output_reference.txt`

2. **Expected Mappings:**
   - first_name + last_name → FullName
   - email → EmailAddress (lowercase)
   - phone → PhoneNumber
   - date_of_birth → BirthDate
   - salary → AnnualSalary
   - department → Dept (with abbreviation mapping)
   - EmployeeID (generated)

3. **Expected Transformations:**
   - Concatenate first and last name
   - Convert email to lowercase
   - Map department names to abbreviations
   - Generate sequential Employee IDs

## Notes

- All files are in CSV/TXT format for easy editing
- Files can be modified to test different scenarios
- Reference files help the AI generate better mappings and transformations

